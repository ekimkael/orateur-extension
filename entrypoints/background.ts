import type { ExtractResult } from "./extract.content"
import { buildHandoffUrl, buildImportUrl, isSavable } from "../lib/handoff"

const MENU_ID = "save-to-orateur"
const EXTRACT_SCRIPT = "/content-scripts/extract.js"

export default defineBackground(() => {
  // Le service worker MV3 redémarre à volonté ; créer le menu ici plutôt que
  // dans main() évite l'erreur "duplicate id" à chaque réveil.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Sauvegarder dans Orateur",
      contexts: ["page", "link"],
    })
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID) return
    // Sur un lien, la cible n'est pas la page ouverte : rien à extraire, et le
    // titre de l'onglet ne décrit pas l'article visé.
    if (info.linkUrl) void handoff(info.linkUrl)
    else void save(tab, info.pageUrl)
  })

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
