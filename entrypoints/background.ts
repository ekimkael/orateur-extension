import type { ExtractResult } from "./extract.content"
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

const MENU_ID = "save-to-orateur"
const SELECTION_MENU_ID = "read-selection-with-orateur"
const EXTRACT_SCRIPT = "/content-scripts/extract.js"

const SELECTION_ERRORS: Record<SelectionError, string> = {
  empty: "Aucun texte sélectionné.",
  "too-short": "Sélection trop courte pour être lue.",
}

const SELECTION_TRUNCATED = "Sélection très longue : seul le début sera lu."

export default defineBackground(() => {
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
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === SELECTION_MENU_ID) {
      void readSelectionFromMenu(info, tab)
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

  // WXT traduit `action` en `browser_action` dans le manifest MV2, mais pas
  // l'API : Firefox MV2 n'expose que browserAction. Pas de polyfill dans le
  // bundle, donc l'alias est à faire à la main.
  const action = browser.action ?? browser.browserAction
  action.onClicked.addListener((tab) => void save(tab))
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
