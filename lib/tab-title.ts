/**
 * Marks the current tab's title while it is reading — the only signal
 * visible from another tab, since neither TTS engine attaches audio to the
 * tab (system speech isn't tab-attributed, Supertonic plays in the offscreen
 * document).
 */

export const MARK = "🔊 "

export const withMark = (title: string) => (title.startsWith(MARK) ? title : MARK + title)

export const withoutMark = (title: string) => (title.startsWith(MARK) ? title.slice(MARK.length) : title)

// ponytail: no <title> observer. A site that rewrites its own title while reading
// drops the mark; add a MutationObserver on <title> if it shows up in practice.
export function markTab(reading: boolean) {
  const next = reading ? withMark(document.title) : withoutMark(document.title)
  if (next !== document.title) document.title = next
}
