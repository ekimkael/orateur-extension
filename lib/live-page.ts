import { createAnchorFinder } from "./read-anchor.ts"
import { detectLang } from "./detect-lang.ts"
import { withStop } from "./reading-intro.ts"
import { toSupertonicLang } from "./supertonic-lang.ts"

const normalize = (text: string) => text.replace(/\s+/g, " ").trim()

function textOf(element: Element) {
  const copy = element.cloneNode(true) as Element
  for (const node of copy.querySelectorAll("script,style,noscript,template,svg,button,input,select,textarea,[hidden],[aria-hidden='true']")) node.remove()
  return normalize(copy.textContent ?? "")
}

/** Keep node identities before a browser translator replaces their text. */
export function createLivePage(doc: Document, blocks: readonly string[], timeout = 5000, isTranslated: () => boolean = () => false) {
  const find = createAnchorFinder(doc)
  const anchors = blocks.map((block) => find(block))
  const original = anchors.map((anchor) => anchor ? textOf(anchor) : "")
  const pending = new Set<() => void>()
  let stopped = false

  async function prepare(index: number, follow: boolean): Promise<string> {
    if (stopped) throw new Error("Reading stopped")
    const fallback = blocks[index] ?? ""
    const element = anchors[index]
    if (!element?.isConnected) return fallback
    const target = toSupertonicLang(doc.documentElement.lang)
    const Observer = doc.defaultView?.MutationObserver
    // Firefox sets html.lang first, but translates offscreen paragraphs only
    // when revealed. Wait before synthesis, not after the audio starts.
    if (follow && target && Observer && isTranslated()) {
      const before = textOf(element)
      const detected = detectLang(before, null)
      const ambiguous = detected === null
      const box = ambiguous ? element.getBoundingClientRect() : null
      const offscreen = box && (box.bottom <= 0 || box.top >= (doc.defaultView?.innerHeight ?? 0))
      if ((detected && detected !== target) || (ambiguous && offscreen)) {
        await new Promise<void>((resolve) => {
          const ready = () => {
            const current = textOf(element)
            return ambiguous ? current !== before : detectLang(current, target) === target
          }
          const finish = () => {
            observer.disconnect()
            clearTimeout(timer)
            pending.delete(finish)
            resolve()
          }
          const observer = new Observer(() => {
            if (ready()) finish()
          })
          const timer = setTimeout(finish, ambiguous ? Math.min(timeout, 1000) : timeout)
          pending.add(finish)
          observer.observe(element, { childList: true, characterData: true, subtree: true })
          element.scrollIntoView({ block: "center", behavior: "instant" })
          if (ready()) finish()
        })
      }
    }
    if (stopped) throw new Error("Reading stopped")
    const current = textOf(element)
    // Retain extraction cleanup and punctuation unless the page text changed.
    return current && current !== original[index] ? withStop(current) : fallback
  }

  function stop() {
    stopped = true
    for (const finish of pending) finish()
  }

  return { anchors, prepare, stop }
}
