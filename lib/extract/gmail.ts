/**
 * Gmail: the open message(s) only, with newsletter preheaders, folded quotes
 * and sponsor cards removed. See docs/gmail-newsletter-extraction.md.
 */

import { clean, extractArticle, NOT_AN_ARTICLE, toSpeakableText, WORDS_PER_MINUTE, type ExtractedArticle } from "../extract-article.ts"
import { countWords, hostnameOf, remove } from "./dom.ts"

/** Body of each open Gmail message — Gmail drops it when leaving the conversation. */
const GMAIL_BODY = ".a3s"
/** "[Message clipped] View entire message", rendered inside the body. */
const GMAIL_CLIPPED = ".iX"
/**
 * Quoted history Gmail folds behind "…" in a thread: hidden by Gmail's own
 * stylesheet, so the copy would repeat every earlier message in each reply.
 * Also found empty and visible in newsletters; only folded ones are dropped.
 */
const GMAIL_TRIMMED = ".adL"
/**
 * Newsletter preheader: the inbox preview line plus zero-width padding,
 * hidden with an inline style since mail clients drop `<style>`. Read from
 * the clone, it would open every newsletter.
 */
const INLINE_HIDDEN = "[style*='display:none' i],[style*='display: none' i]"
/**
 * Label a newsletter prints atop its sponsor card ("PROMOTED" on DEV Digest).
 * Mail markup keeps no class worth matching, so the label is the only trace.
 */
const SPONSOR_LABEL =
  /^(?:promoted|sponsored|sponsor|advertisement|paid partnership|partner content|publicité|sponsorisé|(?:sponsored|presented|brought to you) by\b.*|(?:together|in partnership) with\b.*|en partenariat avec\b.*)$/i
const MAX_SPONSOR_LABEL_LENGTH = 60
/** A card taking more than this share of the message is the layout, not a card. */
const MAX_SPONSOR_SHARE = 0.5

/**
 * Below this share of the whole message, Readability's pick is a fragment of
 * a digest (one Medium card out of ten), not the article inside a newsletter
 * wrapper (ByteByteGo keeps ~40 %, prose newsletters 85 %+).
 */
const MIN_READABLE_SHARE = 0.3

/**
 * The open Gmail message(s), without the app around them.
 *
 * Readability run on the whole Gmail page scores the app too: on a digest of
 * short cards (Medium) a single teaser won. It now runs on the message alone,
 * which still strips newsletter wrappers ("Read in app", "Upgrade to paid");
 * when it keeps too little, or fails, the message is read whole. See
 * docs/gmail-newsletter-extraction.md.
 *
 * The message is copied with `importNode`, never through an HTML string: Gmail
 * enforces Trusted Types, which reject string sinks.
 *
 * `lang` is Gmail's UI language, not the message's: only a prior, which the
 * reader overrides when the text clearly says otherwise (`resolveDocLang`).
 *
 * ponytail: Gmail's obfuscated class names, stable for years; the selectors
 * above are the only thing to update if Gmail renames them. The share
 * threshold is a heuristic; per-sender rules if a newsletter falls on the
 * wrong side.
 *
 * @throws {Error} when no message is open (inbox, search results).
 */
export function extractGmailMessage(
  doc: Document,
  url = doc.location?.href ?? ""
): ExtractedArticle {
  const bodies = doc.querySelectorAll(GMAIL_BODY)
  if (bodies.length === 0) throw new Error(NOT_AN_ARTICLE)

  const message = doc.implementation.createHTMLDocument("")
  for (const body of bodies) message.body.append(message.importNode(body, true))
  // Live layout decides, before the copy loses it: history the reader
  // unfolded with "…" stays. Same document order on both sides.
  const folded = [...doc.querySelectorAll(`${GMAIL_BODY} ${GMAIL_TRIMMED}`)].map(
    (el) => el.getClientRects().length === 0
  )
  message.querySelectorAll(GMAIL_TRIMMED).forEach((el, i) => folded[i] && el.remove())
  const truncated = message.querySelector(GMAIL_CLIPPED) !== null
  remove(message, `${GMAIL_CLIPPED},${INLINE_HIDDEN}`)
  removeSponsorCards(message.body)
  const title = doc.querySelector("h2.hP")?.textContent?.trim() || null
  const lang = doc.documentElement.lang || null

  const root = message.body.cloneNode(true) as Element
  clean(root)
  const textContent = toSpeakableText(root, "")
  if (!textContent) throw new Error(NOT_AN_ARTICLE)

  try {
    const article = extractArticle(message, url)
    if (article.textContent.length >= textContent.length * MIN_READABLE_SHARE) {
      return { ...article, title, lang, truncated }
    }
  } catch {
    // Not readerable, or Readability hit a Trusted Types sink: read it whole.
  }

  return {
    title,
    byline: null,
    dir: null,
    excerpt: null,
    siteName: hostnameOf(url) || null,
    publishedTime: null,
    lang,
    content: root.innerHTML,
    textContent,
    length: textContent.length,
    url,
    readingTimeMinutes: Math.max(1, Math.round(countWords(textContent) / WORDS_PER_MINUTE)),
    truncated,
  }
}

/**
 * Drops each newsletter sponsor card: from its label, up through wrappers that
 * hold nothing else, then one step to the box holding label and pitch, then
 * through that box's own wrappers.
 *
 * ponytail: when that box is most of the message (label and pitch set flat
 * among the articles), only the label goes and the pitch is still read; a
 * sibling-based cut if a newsletter does that.
 */
function removeSponsorCards(root: Element) {
  const textOf = (el: Element) => el.textContent?.trim() ?? ""
  const total = textOf(root).length
  const labels = [...root.querySelectorAll("*")].filter((el) => {
    const text = textOf(el)
    return (
      text.length <= MAX_SPONSOR_LABEL_LENGTH &&
      SPONSOR_LABEL.test(text) &&
      ![...el.children].some((child) => textOf(child) === text)
    )
  })
  for (const label of labels) {
    const text = textOf(label)
    const climbWrappers = (el: Element) => {
      while (el.parentElement && el.parentElement !== root && textOf(el.parentElement) === textOf(el)) {
        el = el.parentElement
      }
      return el
    }
    let card = climbWrappers(label)
    const box = card.parentElement
    if (box && box !== root && textOf(box).startsWith(text) && textOf(box).length <= total * MAX_SPONSOR_SHARE) {
      card = climbWrappers(box)
    }
    card.remove()
  }
}
