/**
 * X (x.com, twitter.com): the opened post or X Article only, never the replies,
 * quotes or app around it. See docs/x-extraction.md.
 */

import { clean, NOT_AN_ARTICLE, toSpeakableText, WORDS_PER_MINUTE, type ExtractedArticle } from "../extract-article.ts"
import { countWords, normalize } from "./dom.ts"

/** X under both names, desktop and mobile. */
const X_HOST = /^(?:mobile\.)?(?:x|twitter)\.com$/

/** True on X (x.com, twitter.com and their mobile hosts). */
export function isXHost(hostname: string): boolean {
  return X_HOST.test(hostname.replace(/^www\./, ""))
}

/** A status path, `/<handle>/status/<id>` or `/i/web/status/<id>`, with or without a suffix. */
const STATUS_PATH = /\/status\/(\d+)/
/** The same path with nothing after the id: a post's own permalink, not its photo or analytics. */
const PERMALINK = /^\/[^/]+\/status\/(\d+)\/?$/

/** The numeric post id of an X status URL, whatever its prefix or suffix. */
export function xStatusId(url: string): string | null {
  try {
    return new URL(url).pathname.match(STATUS_PATH)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Codes X puts in a post's `lang` that name no language: undetermined, no
 * linguistic content, and the private-use `q…` codes (media, hashtags only).
 */
const X_NO_LANG = /^(?:und|zxx|q[a-t][a-z])$/i
/** Longest title (display name and first line) before it is cut on a word. */
const X_TITLE_LENGTH = 100
/**
 * Pictographs and what glues them (skin tones, keycap mark, flag tags):
 * decoration, and some system voices read their names aloud.
 */
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}]/gu
const BARE_URL = /https?:\/\/\S+/g
/**
 * "#EsbiMedia" closing a post, after its last sentence or on its own line: a
 * tag for the feed. One ending a sentence ("Allez les #Lions.") is a word.
 */
const TRAILING_HASHTAGS = /(^|[.!?…\n])(?:\s*#[\p{L}\p{N}_]+)+[\s.]*$/u
/**
 * The sign of a hashtag or mention kept in a sentence: "#titre" is read
 * "titre". A reply's addressee is not in its text (X shows it apart), so a
 * leading mention is the post's own subject and stays.
 */
const TAG_SIGN = /(^|[\s(])[#@](?=[\p{L}\p{N}_])/gu

/**
 * The X post (or X Article) the URL points at, and nothing else on the page.
 *
 * A status page also holds the parent of a reply, the posts it quotes, the
 * replies and the app around them. Readability scored all of that together and
 * picked the longest text: often the parent or a quote, and short posts fell
 * under its `charThreshold` into the whole-page fallback. The post is found by
 * its permalink instead, and nothing falls back to the page: on X a wrong
 * reading is worse than none.
 *
 * Two apps serve the same URL: logged in, the react-native-web app
 * (`data-testid`, quotes under `[role=link]`); logged out, the redesign (no
 * test ids, quotes as nested `article`s). Both keep a post's paragraphs as
 * `\n` in one text node, so lines are split here. See docs/x-extraction.md.
 *
 * The document is never modified. A post's "title" is its author and first
 * line: it names the saved item and the pill, and `announceTitle: false`
 * keeps it from being spoken before that same line.
 *
 * @throws {Error} off a status page, before the post is rendered, or when it
 * holds nothing to read (media, links).
 */
export function extractXPost(doc: Document, url = doc.location?.href ?? ""): ExtractedArticle {
  const id = xStatusId(url)
  const link = id
    ? [...doc.querySelectorAll("article a[href]")].find(
        (a) => a.getAttribute("href")!.match(PERMALINK)?.[1] === id
      )
    : undefined
  const post = link?.closest("article")
  if (!link || !post) throw new Error(NOT_AN_ARTICLE)
  const handle = link.getAttribute("href")!.split("/")[1]!

  const body = post.querySelector(X_ARTICLE_BODY)
  if (body) return xArticle(doc, post, body, url)

  // The opened post's own text: not one under a quote (a nested article, or a
  // [role=link] card). Test ids first: the logged-in app also sets dir=auto on
  // names and labels.
  const own = (el: Element) => {
    for (let node = el.parentElement; node && node !== post; node = node.parentElement) {
      if (node.matches("article, [role='link']")) return false
    }
    return true
  }
  const source =
    [...post.querySelectorAll("[data-testid='tweetText']")].find(own) ??
    [...post.querySelectorAll("div[dir='auto']")].find(own)
  if (!source) throw new Error(NOT_AN_ARTICLE)

  const tagged = source.getAttribute("lang")
  const lang = (tagged && !X_NO_LANG.test(tagged) ? tagged : null) || doc.documentElement.lang || null
  const root = postParagraphs(doc, source)
  const textContent = toSpeakableText(root, lang ?? "", { pruneResidue: false })
  if (!textContent) throw new Error(NOT_AN_ARTICLE)

  const name = [...post.querySelectorAll(`a[href="/${handle}" i]`)]
    .map((a) => normalize((a.textContent ?? "").replace(EMOJI, "")))
    .find((text) => text && !text.startsWith("@"))
  const first = textContent.split("\n\n")[0]!.replace(/\.$/, "")
  return {
    ...xResult(cutTitle(name ? `${name} : ${first}` : first), lang, root, textContent, url),
    byline: name ?? null,
    announceTitle: false,
  }
}

/** An X Article's body: logged-out redesign, then logged-in app. */
const X_ARTICLE_BODY = ".x-article-body, [data-testid='twitterArticleRichTextView']"
/** Its title, beside the body: logged-in test id, then the redesign's `h1`. */
const X_ARTICLE_TITLE = "[data-testid='twitter-article-title'], h1"
/** The blocks of an Article body a removed link can leave as a bare label. */
const LABEL_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, [data-block]"
/** What a removed link leaves of its line: "Link:", "Follow me:". */
const LABEL_ONLY = /^[^.!?]{1,30}:$/

/**
 * An X Article, read from its body to its last line.
 *
 * Authors rarely end a line with a period, so `pruneTrailingResidue` (built
 * for news-site sidebars) would drop the closing lines: it is skipped. Links
 * are the article's resource lists ("Link: https://…"), not prose; the label
 * they leave is dropped with them; linked words (mentions, prices) stay. The logged-in body has no `<p>`: each
 * Draft.js `div[data-block]` is already a block for `toSpeakableText`.
 */
function xArticle(doc: Document, post: Element, body: Element, url: string): ExtractedArticle {
  const title = normalize(post.querySelector(X_ARTICLE_TITLE)?.textContent ?? "") || null
  const root = body.cloneNode(true) as Element
  // Blocks that lost a link or a URL: only those can be a label left behind.
  // "What you'll learn:" before a list is the author's own line.
  const emptied = new Set(dropUrlLinks(root).map((parent) => parent.closest(LABEL_BLOCKS)))
  // 4: NodeFilter.SHOW_TEXT, not a global outside the browser.
  const walker = doc.createTreeWalker(root, 4)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue!.replace(BARE_URL, "")
    if (text !== node.nodeValue) emptied.add(node.parentElement?.closest(LABEL_BLOCKS) ?? null)
    node.nodeValue = text.replace(EMOJI, "").replace(TAG_SIGN, "$1")
  }
  // From the tree, not only the text: the saved copy is read aloud too.
  for (const block of emptied) {
    if (block && LABEL_ONLY.test(normalize(block.textContent ?? ""))) block.remove()
  }
  clean(root)

  const lang = doc.documentElement.lang || null
  const textContent = toSpeakableText(root, lang ?? "", { pruneResidue: false })
  if (!textContent) throw new Error(NOT_AN_ARTICLE)
  return xResult(title, lang, root, textContent, url)
}

/** The fields every X reading shares. */
function xResult(title: string | null, lang: string | null, root: Element, textContent: string, url: string): ExtractedArticle {
  return {
    title,
    byline: null,
    dir: null,
    excerpt: null,
    siteName: "X",
    publishedTime: null,
    lang,
    content: root.innerHTML,
    textContent,
    length: textContent.length,
    url,
    readingTimeMinutes: Math.max(1, Math.round(countWords(textContent) / WORDS_PER_MINUTE)),
  }
}

/**
 * One `<p>` per line of a post, with address links, URLs, emoji and the
 * closing hashtags taken out. Built detached, from a copy.
 */
function postParagraphs(doc: Document, source: Element): Element {
  const copy = source.cloneNode(true) as Element
  dropUrlLinks(copy)
  const text = (copy.textContent ?? "")
    .replace(BARE_URL, "")
    .replace(EMOJI, "")
    .replace(TRAILING_HASHTAGS, "$1")
    .replace(TAG_SIGN, "$1")

  const root = doc.createElement("div")
  for (const line of text.split("\n")) {
    const clean = normalize(line)
    if (!clean) continue
    const p = doc.createElement("p")
    p.textContent = clean
    root.append(p)
  }
  return root
}

/** Link text that is an address: full, bare host/path, or shortened by X with "…". */
const URL_TEXT = /^(?:https?:\/\/|www\.)\S*$|^[\w-]+(?:\.[\w-]+)+\/\S*$|…$/u

/**
 * Drops the links whose text is an address, and returns where they were. The others keep their words:
 * mentions, hashtags and cashtags ("$8.95"), relative in posts but absolute
 * (`https://x.com/search?q=…`) in the logged-in Article body.
 */
function dropUrlLinks(root: Element): Element[] {
  const parents: Element[] = []
  for (const a of root.querySelectorAll("a[href]")) {
    if (!URL_TEXT.test(normalize(a.textContent ?? ""))) continue
    if (a.parentElement) parents.push(a.parentElement)
    a.remove()
  }
  return parents
}

/** Cuts a title on the last word that fits, and says so with an ellipsis. */
function cutTitle(title: string): string {
  if (title.length <= X_TITLE_LENGTH) return title
  const cut = title.slice(0, X_TITLE_LENGTH)
  const space = cut.lastIndexOf(" ")
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}
