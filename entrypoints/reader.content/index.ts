/**
 * Reader pill content script: mounts the pill (`pill.ts`) and the paragraph
 * follower (`follower.ts`), then forwards user actions, extension messages and
 * page lifecycle to the reading session (`lib/reading-session.ts`).
 *
 * The pill sits on every page, folded on a ▶ button while nothing is read, so a
 * reading can start without the context menu. It unfolds into the player while
 * reading.
 */

import { loadPrefs, onPrefsChanged } from "../../lib/reader-prefs"
import { createLivePage } from "../../lib/live-page.ts"
import { findBlockIndex } from "../../lib/read-anchor.ts"
import { createReadingSession } from "../../lib/reading-session.ts"
import { START_READING, type ReadPagePayload, type StartReadingMessage } from "../../lib/reader-messages.ts"
import { isHidden, loadHiddenSites, addHiddenSite, normalizeSite, onHiddenSitesChanged, removeHiddenSite } from "../../lib/site-rules.ts"
import { track } from "../../lib/telemetry.ts"
import { loadUiPrefs, onUiPrefsChanged } from "../../lib/ui-prefs.ts"
import { createFollower } from "./follower.ts"
import { createPill } from "./pill.ts"

export default defineContentScript({
  // Déclaré dans le manifest, contrairement à l'extracteur : la pastille doit
  // déjà être là avant le geste de l'utilisateur. Aucun avertissement de plus,
  // la bulle de sélection réclame déjà <all_urls>.
  matches: ["<all_urls>"],
  runAt: "document_start",
  // Pas d'`allFrames` (défaut : frame principale) : une pastille par page, là
  // où la bulle de sélection en veut une par iframe.
  async main(ctx) {
    const initialPageLanguage = document.documentElement?.lang ?? ""
    if (document.readyState === "loading") {
      await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }))
    }
    const token = Math.random().toString(36).slice(2)
    // Réassigné, pas figé : une lecture doit partir sur les réglages du moment,
    // y compris ceux changés depuis un autre onglet.
    let [prefs, hiddenSites, uiPrefs] = await Promise.all([loadPrefs(), loadHiddenSites(), loadUiPrefs()])
    let contextTarget: Element | null = null

    const pill = createPill(() => void session.toggle(), onSecondary, () => session.navigate(-1), () => session.navigate(1), prefs, !isHidden(location.hostname, hiddenSites), uiPrefs.theme)
    const follower = createFollower()
    follower.setEnabled(prefs.follow)
    const session = createReadingSession({
      token,
      view: pill,
      follower,
      prefs: () => prefs,
      page: {
        liveSource: (paragraphs) => createLivePage(document, paragraphs, 5000, () =>
          document.documentElement.lang !== initialPageLanguage ||
          document.documentElement.classList.contains("translated-ltr") ||
          document.documentElement.classList.contains("translated-rtl")
        ),
        url: canonicalUrl,
        contextBlock: (paragraphs) => findBlockIndex(document, paragraphs, contextTarget),
        confirmResume: () => confirm(browser.i18n.getMessage("readerResumePrompt")),
      },
    })

    browser.runtime.onMessage.addListener(onMessage)
    browser.storage.onChanged.addListener(session.storageChanged)
    document.addEventListener("contextmenu", rememberContextTarget, true)
    const unsubscribeHiddenSites = onHiddenSitesChanged((sites) => {
      if (isHidden(location.hostname, sites)) pill.detach()
      else pill.attach()
    })
    const unsubscribeUiPrefs = onUiPrefsChanged((next) => pill.setTheme(next.theme))
    const unsubscribePrefs = onPrefsChanged((newPrefs) => {
      const previous = prefs
      prefs = newPrefs
      pill.updatePrefs(newPrefs)
      follower.setEnabled(newPrefs.follow)
      session.prefsChanged(previous)
    })
    ctx.addEventListener(window, "pagehide", () => session.pageHidden())
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.storage.onChanged.removeListener(session.storageChanged)
      document.removeEventListener("contextmenu", rememberContextTarget, true)
      unsubscribePrefs()
      unsubscribeHiddenSites()
      unsubscribeUiPrefs()
      session.invalidate()
      pill.remove()
    })

    function onMessage(message: Partial<StartReadingMessage>) {
      if (message?.type !== START_READING || !message.text) return
      void session.start(message as ReadPagePayload, message.fromHere)
    }

    function rememberContextTarget(event: Event) {
      contextTarget = event.target instanceof Element ? event.target : null
    }

    /**
     * ⏹ while reading. ✕ otherwise: hides Orateur on this domain at once, then
     * lets the toast undo it (the storage change re-attaches nothing: the pill
     * never left the page).
     */
    function onSecondary() {
      if (session.reading) return session.stop()
      session.cancel()
      track({ name: "pill_hidden" })
      void addHiddenSite(location.hostname)
      pill.confirmHidden(() => {
        track({ name: "pill_hide_undone" })
        const site = normalizeSite(location.hostname)
        if (site) void removeHiddenSite(site)
      })
    }
  },
})

function canonicalUrl() {
  const href = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href
  const url = new URL(href, location.href)
  url.hash = ""
  return url.href
}
