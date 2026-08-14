import type { ExtractResult } from "./extract.content"
import {
  NOTIFY,
  READ_PAGE,
  READER_TOKEN,
  START_READING,
  type NotifyMessage,
  type StartReadingMessage,
} from "./reader.content"
import {
  GET_SELECTION,
  SELECTION_ACTION,
  type SelectionActionMessage,
  type SelectionPayload,
} from "./selection.content"
import {
  buildHandoffUrl,
  buildImportUrl,
  isSavable,
  textToParagraphHtml,
} from "../lib/handoff"
import {
  validateSelectionText,
  type SelectionError,
} from "../lib/selection-text"
import {
  TTS_CLOSE,
  TTS_CONTROL,
  TTS_EVENT,
  TTS_SET_SPEED,
  TTS_SPEAK,
  TTS_TAB_REMOVED,
  TTS_TOKEN_CHANGED,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsSetSpeedMessage,
  type TtsSpeakMessage,
} from "../lib/tts-messages"
// Importé sans condition, mais retiré du bundle Chrome par l'élimination de
// code mort de Vite : tout usage est gardé par `import.meta.env.FIREFOX`, une
// constante de build. Côté MV3, l'hôte vit dans le document offscreen
// (entrypoints/offscreen/main.ts) — jamais ici, où il alourdirait le service
// worker pour rien.
import { createTtsHost } from "../lib/tts-host"

const MENU_ID = "save-to-orateur"
const SELECTION_MENU_ID = "read-selection-with-orateur"
const READ_PAGE_MENU_ID = "read-page-with-orateur"
const EXTRACT_SCRIPT = "/content-scripts/extract.js"

const SELECTION_ERRORS: Record<SelectionError, string> = {
  empty: "Aucun texte sélectionné.",
  "too-short": "Sélection trop courte pour être lue.",
}

const SELECTION_TRUNCATED = "Sélection très longue : seul le début sera lu."
const PAGE_NOT_INJECTABLE = "Cette page ne peut pas être lue directement."

/**
 * Relais Supertonic entre les pastilles et l'hôte.
 *
 * Chrome MV3 : l'hôte vit dans un document offscreen — seul contexte capable
 * de DOM et `<audio>` hors d'un onglet, mais sans `tabs` ni `storage`
 * (vérifié en phase 0). Le service worker fait le pont dans les deux sens,
 * et reste lui-même sans état : `chrome.offscreen.hasDocument()` est sa
 * seule mémoire, pour survivre à son propre redémarrage en pleine lecture.
 *
 * Firefox MV2 : pas de document offscreen. La page de fond persistante a
 * déjà tout ce qu'il faut — c'est elle l'hôte, directement, sans relais.
 */

/** Faux si le document n'a pas pu être créé — l'appelant doit alors renoncer plutôt que relayer dans le vide. */
async function ensureOffscreen(): Promise<boolean> {
  const api = (globalThis as any).chrome?.offscreen
  if (!api) return false
  if (await api.hasDocument()) return true
  // Deux créations concurrentes : la seconde jette, et c'est le résultat
  // voulu — pas de cache de promesse, il mourrait avec le service worker.
  await api
    .createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Synthèse et lecture Supertonic hors d'un onglet.",
    })
    .catch((e: unknown) => console.error("[orateur] offscreen KO", e))
  return api.hasDocument()
}

/** L'hôte Firefox — une seule instance, gardée en mémoire par la page de fond persistante. */
let firefoxHost: ReturnType<typeof createTtsHost> | null = null
let firefoxTabId: number | null = null
let firefoxToken: string | null = null

function ensureFirefoxHost() {
  if (firefoxHost) return firefoxHost
  firefoxHost = createTtsHost((state) => {
    if (firefoxTabId == null) return
    const event: TtsEventMessage = { type: TTS_EVENT, tabId: firefoxTabId, state }
    void browser.tabs.sendMessage(firefoxTabId, event).catch(() => {})
    if (state.phase === "ended" || state.phase === "error") {
      firefoxTabId = null
      firefoxToken = null
    }
  })
  return firefoxHost
}

/** TTS_SPEAK / TTS_CONTROL / TTS_SET_SPEED envoyés par une pastille — toujours reçus ici avec `sender.tab`. */
async function handleTtsFromPill(
  message: Partial<TtsSpeakMessage> | Partial<TtsControlMessage> | Partial<TtsSetSpeedMessage>,
  tabId: number | undefined
) {
  if (import.meta.env.FIREFOX) {
    const host = ensureFirefoxHost()
    if (message.type === TTS_SPEAK) {
      if (tabId == null || !message.text || !message.lang || !message.voice) return
      firefoxTabId = tabId
      firefoxToken = message.token ?? null
      host.speak({ text: message.text, lang: message.lang, voice: message.voice, speed: message.speed ?? 1 })
    } else if (message.type === TTS_CONTROL && message.action) {
      host.control(message.action)
    } else if (message.type === TTS_SET_SPEED && message.speed != null) {
      host.setSpeed(message.speed)
    }
    return
  }

  if (!(await ensureOffscreen())) {
    // Sans document offscreen, aucun TTS_EVENT ne viendra jamais — sans ce
    // relais direct, la pastille resterait sur "…" indéfiniment.
    if (message.type === TTS_SPEAK && tabId != null) {
      const event: TtsEventMessage = {
        type: TTS_EVENT,
        tabId,
        state: { phase: "error", message: "Impossible de démarrer le moteur Supertonic." },
      }
      void browser.tabs.sendMessage(tabId, event).catch(() => {})
    }
    return
  }
  await browser.runtime.sendMessage({ ...message, tabId }).catch(() => {})
}

export default defineBackground({
  // Firefox seulement (voir le commentaire sur `defineBackground` juste
  // au-dessus) : les sessions ONNX de l'hôte doivent survivre entre deux
  // lectures, pas être rechargées à chaque réveil de la page de fond.
  persistent: true,
  main() {
  // Le service worker MV3 redémarre à volonté ; créer le menu ici plutôt que
  // dans main() évite l'erreur "duplicate id" à chaque réveil.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Sauvegarder dans Orateur",
      contexts: ["page", "link"],
    })
    browser.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: "Lire avec Orateur",
      // N'apparaît que sur une sélection de texte : pas d'entrée morte dans le
      // menu du navigateur, et pas besoin d'y vérifier quoi que ce soit.
      contexts: ["selection"],
    })
    browser.contextMenus.create({
      id: READ_PAGE_MENU_ID,
      title: "Lire cette page",
      // Pas de contexte "link" : on lit le DOM de l'onglet courant, pas la
      // cible d'un lien.
      contexts: ["page"],
    })
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === SELECTION_MENU_ID) {
      void readSelectionFromMenu(info, tab)
      return
    }
    if (info.menuItemId === READ_PAGE_MENU_ID) {
      void readPageInPlace(tab)
      return
    }
    if (info.menuItemId !== MENU_ID) return
    // Sur un lien, la cible n'est pas la page ouverte : rien à extraire, et le
    // titre de l'onglet ne décrit pas l'article visé.
    if (info.linkUrl) void handoff(info.linkUrl)
    else void save(tab, info.pageUrl)
  })

  // La bulle flottante. Aucun contrôle d'origine à faire : sans
  // `externally_connectable`, seules nos propres injections peuvent émettre ici.
  browser.runtime.onMessage.addListener(
    (message: SelectionActionMessage, sender) => {
      if (message?.type !== SELECTION_ACTION) return
      // Une seule action pour l'instant ; les suivantes (traduire, résumer)
      // s'embranchent ici.
      if (message.action === "read") void read(message, sender.tab?.url)
    }
  )

  // La pastille de lecture. Elle attend un booléen pour savoir si elle se
  // déplie ou retombe au repos ; `return true` maintient le canal ouvert le
  // temps de l'extraction — sans polyfill, Chrome ignore une promesse renvoyée.
  browser.runtime.onMessage.addListener(
    (message: { type?: string }, sender, sendResponse) => {
      if (message?.type !== READ_PAGE) return
      void readPageInPlace(sender.tab).then(sendResponse)
      return true
    }
  )

  // Incident signalé par une pastille (ex. langue non prise en charge par
  // Supertonic) : même badge que les autres avertissements de l'extension.
  browser.runtime.onMessage.addListener((message: Partial<NotifyMessage>) => {
    if (message?.type !== NOTIFY || !message.message) return
    void notify(message.message)
  })

  // TTS_SPEAK / TTS_CONTROL depuis une pastille : toujours reçus ici en
  // premier, `sender.tab` fiable (contrairement au document offscreen, qui
  // reçoit la même diffusion en double — voir offscreen/main.ts).
  browser.runtime.onMessage.addListener(
    (
      message: Partial<TtsSpeakMessage> | Partial<TtsControlMessage> | Partial<TtsSetSpeedMessage>,
      sender
    ) => {
      if (message?.type !== TTS_SPEAK && message?.type !== TTS_CONTROL && message?.type !== TTS_SET_SPEED) return
      void handleTtsFromPill(message, sender.tab?.id)
    }
  )

  // TTS_EVENT : dans l'autre sens, du document offscreen vers l'onglet
  // propriétaire. N'existe que côté Chrome — la page de fond Firefox parle
  // déjà directement à l'onglet dans `ensureFirefoxHost`.
  if (!import.meta.env.FIREFOX) {
    browser.runtime.onMessage.addListener((message: Partial<TtsEventMessage>) => {
      if (message?.type !== TTS_EVENT || message.tabId == null) return
      void browser.tabs.sendMessage(message.tabId, message).catch(() => {})
    })

    // Démontage : l'hôte demande sa propre fermeture après une inactivité
    // prolongée (voir offscreen/main.ts). Rien d'équivalent sur Firefox — la
    // page de fond persistante n'a pas de pendant à `closeDocument()`, et
    // n'a pas besoin d'en avoir : c'est déjà elle qui reste en mémoire pour
    // que `persistent: true` garde les sessions ONNX chaudes entre lectures.
    browser.runtime.onMessage.addListener((message: { type?: string }) => {
      if (message?.type !== TTS_CLOSE) return
      void (globalThis as any).chrome?.offscreen?.closeDocument().catch(() => {})
    })
  }

  // L'audio orphelin : un autre onglet prend la parole (READER_TOKEN change)
  // pendant qu'un onglet différent lit avec Supertonic. Sans ce relais,
  // l'hôte — qui n'a pas `storage` côté Chrome — ne l'apprendrait jamais.
  browser.storage.onChanged.addListener((changes) => {
    if (!(READER_TOKEN in changes)) return
    const token = changes[READER_TOKEN].newValue as string | undefined
    if (import.meta.env.FIREFOX) {
      if (token === firefoxToken) return
      firefoxHost?.control("stop")
      firefoxTabId = null
      firefoxToken = null
      return
    }
    void browser.runtime.sendMessage({ type: TTS_TOKEN_CHANGED, token }).catch(() => {})
  })

  // Filet complémentaire : l'onglet qui lisait a pu être fermé sans qu'aucun
  // autre n'ait pris la parole — READER_TOKEN ne bouge pas dans ce cas.
  browser.tabs.onRemoved.addListener((tabId) => {
    if (import.meta.env.FIREFOX) {
      if (tabId !== firefoxTabId) return
      firefoxHost?.control("stop")
      firefoxTabId = null
      firefoxToken = null
      return
    }
    void browser.runtime.sendMessage({ type: TTS_TAB_REMOVED, tabId }).catch(() => {})
  })

  // WXT traduit `action` en `browser_action` dans le manifest MV2, mais pas
  // l'API : Firefox MV2 n'expose que browserAction. Pas de polyfill dans le
  // bundle, donc l'alias est à faire à la main.
  const action = browser.action ?? browser.browserAction
  action.onClicked.addListener((tab, info?: { modifiers?: string[] }) => {
    // Le second paramètre (modificateurs clavier) n'existe que sur Firefox ;
    // Chrome n'appelle le listener qu'avec `tab`. `info` y vaut donc toujours
    // `undefined`, et l'alt-clic y reste indisponible.
    if (info?.modifiers?.includes("Alt")) void readPageInPlace(tab)
    else void save(tab)
  })
  },
})

/**
 * Extrait l'article de l'onglet, puis le transfère à Orateur.
 *
 * Trois issues : contenu extrait (transfert direct, Orateur ne refetche rien),
 * page qui n'est pas un article (refus immédiat plutôt qu'un import illisible),
 * onglet non injectable (repli sur l'import serveur d'Orateur).
 */
async function save(
  tab: { id?: number; url?: string; title?: string } | undefined,
  pageUrl?: string
) {
  const url = tab?.url ?? pageUrl
  if (!isSavable(url)) return

  const result = tab?.id == null ? null : await extractFromTab(tab.id)

  if (result?.ok === false) {
    await notify(result.error)
    return
  }

  if (result?.ok) {
    const { content, title, lang } = result.article
    await open(buildImportUrl({ content, title, lang, url }))
    return
  }

  await handoff(url, tab?.title)
}

/**
 * Lit la sélection demandée depuis le menu contextuel du navigateur.
 *
 * Le content script est interrogé en premier : `info.selectionText` est aplati
 * par le navigateur, tronqué par Chrome, et ignore les champs de formulaire. Il
 * ne sert que de repli, sur les pages où le script n'a pas pu s'injecter
 * (visionneuse PDF, pages internes, boutique d'extensions).
 */
async function readSelectionFromMenu(
  info: { selectionText?: string; frameId?: number; pageUrl?: string },
  tab: { id?: number; url?: string; title?: string } | undefined
) {
  const url = tab?.url ?? info.pageUrl

  const captured =
    tab?.id == null ? null : await askContentScript(tab.id, info.frameId)
  if (captured) return read(captured, url)

  const result = validateSelectionText(info.selectionText ?? "")
  if (!result.ok) return notify(SELECTION_ERRORS[result.reason])

  await read(
    { text: result.text, truncated: result.truncated, title: tab?.title },
    url
  )
}

async function askContentScript(tabId: number, frameId?: number) {
  try {
    return (await browser.tabs.sendMessage(
      tabId,
      { type: GET_SELECTION },
      { frameId }
    )) as SelectionPayload | null
  } catch {
    return null
  }
}

/**
 * Transfère la sélection au lecteur d'Orateur.
 *
 * Même route et même contrat que la sauvegarde d'article : le contenu voyage
 * dans le fragment et `/articles/new` s'occupe du reste. Comme partout ailleurs
 * dans l'extension, un onglet est ouvert — c'est Orateur qui décide de ce qu'il
 * advient d'une lecture déjà en cours.
 */
async function read(payload: SelectionPayload, url?: string) {
  if (payload.truncated) await notify(SELECTION_TRUNCATED)

  await open(
    buildImportUrl({
      // Jamais le HTML de la page : du texte échappé, remis en paragraphes.
      content: textToParagraphHtml(payload.text),
      title: payload.title,
      url: isSavable(url) ? url : undefined,
      lang: payload.lang,
    })
  )
}

/**
 * Extrait l'article de l'onglet et le lit sur place, via `speechSynthesis`
 * dans la page — rien n'est envoyé à Orateur.
 *
 * Plus rien à injecter : le lecteur est un content script déclaré, présent
 * partout où l'extracteur peut s'injecter. Le booléen renvoyé sert à la
 * pastille, qui attend de savoir si la lecture a démarré.
 */
async function readPageInPlace(tab: { id?: number; url?: string } | undefined) {
  if (tab?.id == null) return false

  const result = await extractFromTab(tab.id)
  if (result?.ok === false) {
    await notify(result.error)
    return false
  }
  if (!result?.ok) {
    await notify(PAGE_NOT_INJECTABLE)
    return false
  }

  await browser.tabs.sendMessage(tab.id, {
    type: START_READING,
    text: result.article.textContent,
    title: result.article.title ?? undefined,
    lang: result.article.lang ?? undefined,
  } satisfies StartReadingMessage)
  return true
}

async function handoff(url: string, title?: string | null) {
  await open(buildHandoffUrl(url, title ?? undefined))
}

async function open(url: string) {
  await browser.tabs.create({ url })
}

/**
 * Exécute l'extracteur dans l'onglet et récupère sa valeur de retour.
 *
 * Deux API pour un même geste : `scripting` n'existe qu'en MV3, Firefox MV2 ne
 * connaît que `tabs.executeScript`. Les deux enveloppent le résultat
 * différemment.
 */
async function extractFromTab(tabId: number): Promise<ExtractResult | null> {
  try {
    if (browser.scripting) {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        files: [EXTRACT_SCRIPT],
      })
      return (injection?.result as ExtractResult | undefined) ?? null
    }

    const results = await browser.tabs.executeScript(tabId, {
      file: EXTRACT_SCRIPT,
    })
    return (results?.[0] as ExtractResult | undefined) ?? null
  } catch {
    // Page non injectable (about:, addons.mozilla.org, PDF viewer…).
    return null
  }
}

async function notify(message: string) {
  const action = browser.action ?? browser.browserAction
  await action.setBadgeText({ text: "!" })
  await action.setTitle({ title: message })
  setTimeout(() => {
    void action.setBadgeText({ text: "" })
    void action.setTitle({ title: "" })
  }, 4000)
}
