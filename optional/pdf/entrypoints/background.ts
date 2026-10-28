import { pdfTabSource } from "../../../lib/pdf-source"

const MENU = "orateur-pdf:read"

async function openReader(url?: string) {
  const source = pdfTabSource(url)
  const reader = new URL("pdf.html", browser.runtime.getURL("/"))
  if (source) reader.hash = new URLSearchParams({ url: source }).toString()
  await browser.tabs.create({ url: reader.href })
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() => browser.contextMenus.create({
      id: MENU, title: browser.i18n.getMessage("menuReadPdfTitle"), contexts: ["page", "link"],
      documentUrlPatterns: ["http://*/*", "https://*/*", "file:///*"],
    }))
  })
  const action = browser.action ?? browser.browserAction
  action.onClicked.addListener((tab) => { void openReader(tab.url) })
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU) void openReader(info.linkUrl ?? tab?.url ?? info.pageUrl)
  })
})
