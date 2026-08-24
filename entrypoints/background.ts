import type { ExtractResult } from "./extract.content"
import {
  NOTIFY,
  READ_PAGE,
  READER_TOKEN,
  START_READING,
  type NotifyMessage,
  type ReadPagePayload,
  type StartReadingMessage,
} from "./reader.content"
import {
  GET_SELECTION,
  SELECTION_ACTION,
  type SelectionAction,
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
import { TELEMETRY_TRACK, track, handleTelemetryTrack, type TelemetryTrackMessage } from "../lib/telemetry"
// Importé sans condition, mais retiré du bundle Chrome par l'élimination de
// code mort de Vite : tout usage est gardé par `import.meta.env.FIREFOX`, une
// constante de build. Côté MV3, l'hôte vit dans le document offscreen
// (entrypoints/offscreen/main.ts) — jamais ici, où il alourdirait le service
// worker pour rien.
import { createTtsHost } from "../lib/tts-host"

const MENU_ID = "save-to-orateur"
const SELECTION_MENU_ID = "read-selection-with-orateur"
const SAVE_SELECTION_MENU_ID = "save-selection-with-orateur"
const READ_PAGE_MENU_ID = "read-page-with-orateur"
const EXTRACT_SCRIPT = "/content-scripts/extract.js"

// Clés, pas les messages résolus : WXT importe ce module dans un faux
// `browser` (sans `i18n`) pour en lire la config au build — un `const` résolu
// à l'import planterait cette étape. `browser.i18n.getMessage` n'est donc
// appelé que depuis l'intérieur d'une fonction, au premier vrai déclenchement
// du service worker.
//
// Dérivé du type de `getMessage` plutôt qu'une union recopiée à la main :
// TypeScript prend la dernière surcharge d'une fonction surchargée, qui est
// justement celle listant toutes les clés de public/_locales/*/messages.json.
type MessageKey = Parameters<typeof browser.i18n.getMessage>[0]
const SELECTION_ERROR_KEYS: Record<SelectionError, MessageKey> = {
  empty: "errorSelectionEmpty",
  "too-short": "errorSelectionTooShort",
}

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
        state: { phase: "error", message: browser.i18n.getMessage("errorSupertonicStartFailed") },
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
  // dans main() évite l'erreur "duplicate id" à chaque réveil. `onInstalled`
  // se déclenche aussi sur une mise à jour — `details.reason` isole la
  // première installation, seul moment qui compte pour `installed` et pour
  // l'écran de consentement télémétrie (jalon 1c) : une mise à jour ne doit
  // rouvrir ni compter comme un nouvel utilisateur.
  browser.runtime.onInstalled.addListener((details) => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: browser.i18n.getMessage("menuSaveTitle"),
      contexts: ["page", "link"],
    })
    browser.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: browser.i18n.getMessage("menuReadSelectionTitle"),
      // N'apparaît que sur une sélection de texte : pas d'entrée morte dans le
      // menu du navigateur, et pas besoin d'y vérifier quoi que ce soit.
      contexts: ["selection"],
    })
    browser.contextMenus.create({
      id: SAVE_SELECTION_MENU_ID,
      title: browser.i18n.getMessage("menuReadLaterSelectionTitle"),
      contexts: ["selection"],
    })
    browser.contextMenus.create({
      id: READ_PAGE_MENU_ID,
      title: browser.i18n.getMessage("menuReadPageTitle"),
      // Pas de contexte "link" : on lit le DOM de l'onglet courant, pas la
      // cible d'un lien.
      contexts: ["page"],
    })

    if (details.reason === "install") {
      track({ name: "installed" })
      // Le seul endroit qui explique le consentement télémétrie avant de le
      // demander (voir entrypoints/options/App.tsx) — pas de mur nu.
      void browser.runtime.openOptionsPage()
    }
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === SELECTION_MENU_ID) {
      void selectionFromMenu("read", info, tab)
      return
    }
    if (info.menuItemId === SAVE_SELECTION_MENU_ID) {
      void selectionFromMenu("save", info, tab)
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
      if (message.action === "read") void read(message, sender.tab?.id)
      else if (message.action === "save") void saveSelection(message, sender.tab?.url)
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

  // Télémétrie (jalon 1c) : seul endroit qui fait vraiment le fetch() vers
  // PostHog — voir l'en-tête de lib/telemetry.ts sur pourquoi ça ne peut pas
  // partir d'un content script.
  browser.runtime.onMessage.addListener((message: Partial<TelemetryTrackMessage>) => {
    if (message?.type !== TELEMETRY_TRACK || !message.event) return
    void handleTelemetryTrack(message.event)
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
    track({ name: "extraction_failed", properties: { reason: "not_article" } })
    await notify(result.error)
    return
  }

  if (result?.ok) {
    const { content, title, lang } = result.article
    await open(buildImportUrl({ content, title, lang, url }))
    return
  }

  // Pas un échec ici : Orateur refetche la page lui-même, ce n'est pas un cul-de-sac.
  await handoff(url, tab?.title)
}

/**
 * Résout la sélection demandée depuis le menu contextuel du navigateur, puis
 * l'envoie à l'action choisie (lire sur place, ou lire plus tard sur Orateur).
 *
 * Le content script est interrogé en premier : `info.selectionText` est aplati
 * par le navigateur, tronqué par Chrome, et ignore les champs de formulaire. Il
 * ne sert que de repli, sur les pages où le script n'a pas pu s'injecter
 * (visionneuse PDF, pages internes, boutique d'extensions).
 */
async function selectionFromMenu(
  action: SelectionAction,
  info: { selectionText?: string; frameId?: number; pageUrl?: string },
  tab: { id?: number; url?: string; title?: string } | undefined
) {
  const url = tab?.url ?? info.pageUrl

  const captured =
    tab?.id == null ? null : await askContentScript(tab.id, info.frameId)
  if (captured) {
    if (action === "read") return read(captured, tab?.id)
    return saveSelection(captured, url)
  }

  const result = validateSelectionText(info.selectionText ?? "")
  if (!result.ok) return notify(browser.i18n.getMessage(SELECTION_ERROR_KEYS[result.reason]))

  const payload: SelectionPayload = { text: result.text, truncated: result.truncated, title: tab?.title }
  if (action === "read") await read(payload, tab?.id)
  else await saveSelection(payload, url)
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
 * Lit la sélection sur place, comme « Lire cette page » — même pastille, même
 * moteur, aucun appel réseau.
 *
 * Sans `title` : `buildReadingIntro` annoncerait « Au programme : <titre de la
 * page> » avant un extrait qui n'en est qu'un morceau. La pastille reste donc
 * sans libellé, ce qui est juste — il n'y a pas d'article à nommer.
 */
async function read(payload: SelectionPayload, tabId?: number) {
  if (payload.truncated) await notify(browser.i18n.getMessage("noticeSelectionTruncated"))

  if (tabId != null && (await startReading(tabId, { text: payload.text, lang: payload.lang }))) return
  await notify(browser.i18n.getMessage("errorPageNotInjectable"))
}

/**
 * Transfère la sélection au lecteur d'Orateur, pour l'écouter plus tard.
 *
 * Même route et même contrat que la sauvegarde d'article : le contenu voyage
 * dans le fragment et `/articles/new` s'occupe du reste. Comme partout ailleurs
 * dans l'extension, un onglet est ouvert — c'est Orateur qui décide de ce qu'il
 * advient d'une lecture déjà en cours.
 */
async function saveSelection(payload: SelectionPayload, url?: string) {
  if (payload.truncated) await notify(browser.i18n.getMessage("noticeSelectionTruncated"))

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
    // Repli jalon 5 : Gmail, Substack, docs — Readability n'y voit pas
    // d'article, mais il y a de la prose visible à lire. Pas de `title` : ce
    // n'est pas un article nommable, même raison que la lecture d'une
    // sélection (voir `read()` ci-dessous).
    if (result.text) {
      track({ name: "extraction_failed", properties: { reason: "fallback_text" } })
      return startReading(tab.id, { text: result.text, lang: result.lang })
    }
    track({ name: "extraction_failed", properties: { reason: "not_article" } })
    await notify(result.error)
    return false
  }
  if (!result?.ok) {
    // La visionneuse PDF n'accepte aucun content script : pas de repli
    // possible ici, mais le menu contextuel sur une sélection, lui, marche
    // (voir `selectionFromMenu`) — le message le dit.
    const pdf = /\.pdf(?:$|[?#])/i.test(tab.url ?? "")
    track({ name: "extraction_failed", properties: { reason: pdf ? "pdf" : "not_injectable" } })
    await notify(browser.i18n.getMessage(pdf ? "errorPdfUseSelection" : "errorPageNotInjectable"))
    return false
  }

  return startReading(tab.id, {
    text: result.article.textContent,
    title: result.article.title ?? undefined,
    lang: result.article.lang ?? undefined,
  })
}

/** Faux si aucun content script ne répond dans l'onglet. */
async function startReading(tabId: number, payload: ReadPagePayload) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: START_READING,
      ...payload,
    } satisfies StartReadingMessage)
    return true
  } catch {
    return false
  }
}

async function handoff(url: string, title?: string | null) {
  await open(buildHandoffUrl(url, title ?? undefined))
}

async function open(url: string) {
  await browser.tabs.create({ url })
}

/** Un seul essai avant de rendre la main — jalon 5, voir `extractFromTab`. */
const RETRY_DELAY = 700

/**
 * Extrait l'article de l'onglet, avec une reprise ciblée — jalon 5.
 *
 * Premier essai sur la frame principale seule, comme avant. S'il échoue *sans
 * que l'injection elle-même ait échoué* (page non injectable : `null`
 * immédiat, pas de repli possible), un second essai, différé et élargi à
 * toutes les frames, couvre deux cibles à la fois : la SPA dont le contenu
 * arrive après coup, et l'article logé dans une iframe.
 *
 * ponytail: une seule reprise, pas de `MutationObserver` ni de
 * `webNavigation` — et elle ne coûte le délai qu'au chemin d'échec ; un
 * article classique, trouvé du premier coup, ne le paie jamais.
 */
async function extractFromTab(tabId: number): Promise<ExtractResult | null> {
  const firstPass = await injectAll(tabId, false)
  if (firstPass.length === 0) return null // page non injectable : rien à reprendre
  const first = best(firstPass)
  if (first?.ok) return first

  await sleep(RETRY_DELAY)
  return best(await injectAll(tabId, true)) ?? first
}

/**
 * Exécute l'extracteur dans l'onglet et récupère la valeur de retour de
 * chaque frame injectée. Tableau vide si l'injection elle-même a échoué
 * (about:, addons.mozilla.org, visionneuse PDF…) — à distinguer d'un
 * extracteur qui a tourné mais rendu un échec (`ok: false`).
 *
 * Deux API pour un même geste : `scripting` n'existe qu'en MV3, Firefox MV2 ne
 * connaît que `tabs.executeScript`. Les deux enveloppent le résultat
 * différemment.
 */
async function injectAll(tabId: number, allFrames: boolean): Promise<ExtractResult[]> {
  try {
    if (browser.scripting) {
      const injections = await browser.scripting.executeScript({
        target: { tabId, allFrames },
        files: [EXTRACT_SCRIPT],
      })
      return injections
        .map((injection) => injection.result as ExtractResult | undefined)
        .filter((result): result is ExtractResult => result != null)
    }

    const results = await browser.tabs.executeScript(tabId, {
      file: EXTRACT_SCRIPT,
      allFrames,
    })
    return (results ?? []).filter((result): result is ExtractResult => result != null)
  } catch {
    return []
  }
}

/**
 * Le meilleur résultat parmi les frames injectées : un article trouvé plutôt
 * qu'un échec, le texte le plus long à égalité de catégorie — la frame
 * principale d'un site à widgets peut ne rendre qu'un fil publicitaire pendant
 * qu'une iframe contient l'article.
 */
function best(results: ExtractResult[]): ExtractResult | null {
  const articles = results.filter(
    (result): result is Extract<ExtractResult, { ok: true }> => result.ok
  )
  if (articles.length > 0) {
    return articles.reduce((longest, article) =>
      article.article.textContent.length > longest.article.textContent.length ? article : longest
    )
  }

  const fallbacks = results.filter(
    (result): result is Extract<ExtractResult, { ok: false }> => !result.ok && !!result.text
  )
  if (fallbacks.length > 0) {
    return fallbacks.reduce((longest, fallback) =>
      (fallback.text?.length ?? 0) > (longest.text?.length ?? 0) ? fallback : longest
    )
  }

  return results[0] ?? null
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
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
