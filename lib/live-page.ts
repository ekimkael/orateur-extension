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
  const pending = new Map<number, {
    promise: Promise<string>
    update: (follow: boolean, prefetch: boolean, align: "center" | "nearest") => void
    stop: () => void
  }>()
  let stopped = false

  function prepare(index: number, follow: boolean, prefetch = false, align: "center" | "nearest" = "center"): Promise<string> {
    if (stopped) return Promise.reject(new Error("Reading stopped"))
    const existing = pending.get(index)
    if (existing) {
      existing.update(follow, prefetch, align)
      return existing.promise
    }
    const fallback = blocks[index] ?? ""
    const element = anchors[index]
    if (!element?.isConnected) return Promise.resolve(fallback)
    const currentText = () => {
      const current = element.isConnected ? textOf(element) : ""
      // Retain extraction cleanup and punctuation unless the page text changed.
      return current && current !== original[index] ? withStop(current) : fallback
    }
    const target = toSupertonicLang(doc.documentElement.lang)
    const Observer = doc.defaultView?.MutationObserver
    const exempt = () => !!element.closest("[translate='no' i],.notranslate")
    if (!follow || !target || !Observer || !isTranslated() || exempt()) return Promise.resolve(currentText())
    const before = textOf(element)
    const detected = detectLang(before, null)
    const ambiguous = detected === null
    const box = ambiguous ? element.getBoundingClientRect() : null
    const visible = box && box.bottom > 0 && box.top < (doc.defaultView?.innerHeight ?? 0)
    if (detected === target || visible) return Promise.resolve(currentText())

    let resolve!: (text: string) => void
    let reject!: (error: Error) => void
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
    let timer: ReturnType<typeof setTimeout> | undefined
    let settling: ReturnType<typeof setTimeout> | undefined
    let active = false
    let settled = false
    let following: boolean = follow
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      clearTimeout(settling)
      pending.delete(index)
      if (error) reject(error)
      else resolve(currentText())
    }
    const ready = () => {
      clearTimeout(settling)
      const currentTarget = toSupertonicLang(doc.documentElement.lang)
      if (!element.isConnected || !following || !currentTarget || !isTranslated() || exempt()) {
        finish()
        return true
      }
      const current = textOf(element)
      if (ambiguous ? !!current && current !== before : detectLang(current, null) === currentTarget) {
        // Translators can replace several inline nodes in separate batches.
        settling = setTimeout(() => finish(), 75)
        return true
      }
      return false
    }
    const observer = new Observer(ready)
    const update = (follow: boolean, prefetch: boolean, align: "center" | "nearest") => {
      following = follow
      if (ready() || prefetch || active) return
      active = true
      // Passive lookahead must never turn an untranslated snapshot into audio.
      // Only the current paragraph reveals itself and starts a bounded wait.
      timer = setTimeout(() => finish(ambiguous ? undefined : new Error("La traduction de ce paragraphe n’est pas encore disponible.")), ambiguous ? Math.min(timeout, 1000) : timeout)
      try {
        element.scrollIntoView({ block: align, behavior: "instant" })
        ready()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    pending.set(index, { promise, update, stop: () => finish(new Error("Reading stopped")) })
    observer.observe(element, { childList: true, characterData: true, subtree: true })
    update(follow, prefetch, align)
    return promise
  }

  function stop() {
    stopped = true
    for (const job of pending.values()) job.stop()
  }

  return { anchors, prepare, stop }
}
