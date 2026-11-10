/** DOM and text helpers shared by the article, Gmail, X and site extractors. */

/**
 * Removes every match. `querySelectorAll` returns a static list, so removing
 * while iterating is safe, and removing a parent makes its children's
 * `.remove()` a no-op.
 */
export function remove(scope: Document | Element, selectors: string) {
  for (const node of scope.querySelectorAll(selectors)) node.remove()
}

/** Collapses whitespace runs into single spaces and trims the ends. */
export function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

/** Words in a text, for the reading time. */
export function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

/** The URL's hostname, or "" when it does not parse. */
export function hostnameOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}
