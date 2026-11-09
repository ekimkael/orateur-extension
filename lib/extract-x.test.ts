import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { JSDOM } from "jsdom"
import type { ExtractedArticle } from "./extract-article.ts"
import { extractXPost, isXHost, xStatusId } from "./extract/x.ts"
import { blockRange, createAnchorFinder } from "./read-anchor.ts"

// Fixtures: real X pages captured on 2026-11-05 in Firefox, reduced by hand.
// "in" is the logged-in app (react-native-web, data-testid), "out" the
// logged-out redesign (Tailwind, nested quote articles). See docs/x-extraction.md.
const LONG_URL = "https://x.com/EsBi_Media/status/2117662525101617472"
const QUOTE_URL = "https://x.com/RucellVie/status/2117967170156060776"
const REPLY_URL = "https://x.com/Lumineux59/status/2117703791848120757"

const load = (name: string, url: string) =>
  new JSDOM(readFileSync(new URL(`../tests/fixtures/x/${name}.html`, import.meta.url), "utf8"), { url }).window.document
const blocks = (article: ExtractedArticle) => article.textContent.split("\n\n")

for (const view of ["in", "out"]) {
  test(`${view}: long post reads its four paragraphs, without emoji or trailing hashtag`, () => {
    const article = extractXPost(load(`${view}-long`, LONG_URL), LONG_URL)
    assert.equal(blocks(article).length, 4)
    assert.match(blocks(article)[0], /^DIPLOMATIE - EXTRADITION CASSÉE/)
    assert.match(blocks(article)[1], /^L’affaire secoue les chancelleries/)
    assert.match(blocks(article).at(-1)!, /rebondissements spectaculaires\.$/)
    assert.doesNotMatch(article.textContent, /#|🛑|EsbiMedia|@EsBi_Media|Vues|Views/)
    assert.equal(article.announceTitle, false)
    assert.equal(article.siteName, "X")
    assert.equal(article.lang, "fr")
    assert.ok(article.title!.startsWith("EsbiMedia : DIPLOMATIE - EXTRADITION CASSÉE"), article.title!)
    assert.ok(article.title!.length <= 101)
  })

  test(`${view}: the opened post anchors the highlight of its first paragraph`, () => {
    const doc = load(`${view}-long`, LONG_URL)
    const anchor = createAnchorFinder(doc)(blocks(extractXPost(doc, LONG_URL))[0]!)
    assert.ok(anchor, "first paragraph found in the page")
    assert.ok(anchor.closest("article")?.querySelector(`a[href$="/status/2117662525101617472"]`))
    assert.match(anchor.textContent ?? "", /L’affaire secoue/, "the whole post, not a fragment")
  })

  test(`${view}: post with nested quotes reads only the opened post`, () => {
    const article = extractXPost(load(`${view}-quote`, QUOTE_URL), QUOTE_URL)
    assert.equal(article.textContent, "Tu veux même souvent lire, tellement c’est souvent hyper long ça décourage.")
  })

  test(`${view}: short reply reads the reply, not its parent`, () => {
    const article = extractXPost(load(`${view}-reply`, REPLY_URL), REPLY_URL)
    assert.equal(article.textContent, "Un caporal chef n’est pas un sous-officier.")
  })
}

test("status id survives suffixes, prefixes and handle case", () => {
  for (const url of [
    "https://x.com/EsBi_Media/status/2117662525101617472/photo/1",
    "https://x.com/esbi_media/status/2117662525101617472?s=20",
    "https://twitter.com/i/web/status/2117662525101617472",
  ]) assert.equal(xStatusId(url), "2117662525101617472")
  assert.equal(xStatusId("https://x.com/EsBi_Media"), null)
})

test("X hosts", () => {
  for (const host of ["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"]) assert.ok(isXHost(host), host)
  assert.ok(!isXHost("example.com"))
  assert.ok(!isXHost("nox.com"))
})

/** One logged-in post, with `body` as the inner HTML of its tweetText. */
function post(body: string, url = "https://x.com/someone/status/42") {
  return new JSDOM(`<html lang="fr"><body><main>
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/someone"><span>Someone</span></a><a href="/someone"><span>@someone</span></a></div>
      <div data-testid="tweetText" lang="fr">${body}</div>
      <a href="/someone/status/42"><time>3 nov.</time></a>
    </article>
  </main></body></html>`, { url }).window.document
}

test("profile, unrendered status page and media-only post are not readable", () => {
  assert.throws(() => extractXPost(post("Bonjour", "https://x.com/someone"), "https://x.com/someone"), /pas d'article lisible/)
  const loading = new JSDOM(`<html><body><main><div>Chargement…</div></main></body></html>`).window.document
  assert.throws(() => extractXPost(loading, "https://x.com/someone/status/42"), /pas d'article lisible/)
  assert.throws(() => extractXPost(post(`<a href="https://t.co/abc">pic.x.com/abc</a> 🔥`)), /pas d'article lisible/)
})

test("inline hashtag and mention are read without their sign; links are dropped", () => {
  const doc = post(`Bravo <a href="/Fcbarcelona">@Fcbarcelona</a> pour le <a href="/hashtag/titre?src=hashtag_click">#titre</a> ce soir <a href="https://t.co/abc">https://t.co/abc</a>`)
  assert.equal(extractXPost(doc).textContent, "Bravo Fcbarcelona pour le titre ce soir.")
})

const ARTICLE_URL = "https://x.com/DeRonin_/status/2095180126359105955"

for (const view of ["in", "out"]) {
  test(`${view}: X Article reads its title, body and last lines, without URLs or chrome`, () => {
    const article = extractXPost(load(`${view}-article`, ARTICLE_URL), ARTICLE_URL)
    assert.equal(article.title, "How to become a Robotics Engineer in 6 months (RESOURCES)")
    assert.equal(article.announceTitle, undefined)
    assert.equal(blocks(article)[0], "Robotics is the least crowded high-value skill in tech right now.")
    assert.ok(blocks(article).includes("Why robotics and not AI engineering."))
    assert.deepEqual(blocks(article).slice(-2), ["Go build something that moves.", "Hope this was useful for you my fam."])
    assert.doesNotMatch(article.textContent, /https?:|www\.|Link:|More Articles|Vous voulez publier|Passer à|followers|vues|Views|CEO of Arcane/)
  })
}

test("X Article code block is announced, not read", () => {
  const doc = new JSDOM(`<html lang="en"><body><main><article>
    <a href="/someone/status/42">2:00 PM</a>
    <h1>Shipping code</h1>
    <div class="x-article-body"><p>Run this first.</p><pre><code>npm ci</code></pre><p>Then build.</p></div>
  </article></main></body></html>`, { url: "https://x.com/someone/status/42" }).window.document
  const article = extractXPost(doc)
  assert.equal(article.textContent, "Run this first.\n\nYou can get an overview by looking at the code below.\n\nThen build.")
})

test("a hashtag ending a sentence stays a word; a trailing tag line goes", () => {
  assert.equal(extractXPost(post(`Allez les <a href="/hashtag/Lions">#Lions</a>.`)).textContent, "Allez les Lions.")
  assert.equal(extractXPost(post(`Victoire. <a href="/hashtag/Lions">#Lions</a> <a href="/hashtag/CAN">#CAN</a>`)).textContent, "Victoire.")
})

test("a post opening on a mention keeps its subject", () => {
  assert.equal(extractXPost(post(`<a href="/Fcbarcelona">@Fcbarcelona</a> a gagné hier`)).textContent, "Fcbarcelona a gagné hier.")
})

test("emoji leave no modifier, keycap or tag behind", () => {
  assert.equal(extractXPost(post("Merci 👍🏽 1️⃣ 🏴󠁧󠁢󠁥󠁮󠁧󠁿 bravo")).textContent, "Merci 1 bravo.")
})

test("X Article keeps linked words and prices, drops URLs and the labels they leave", () => {
  const doc = new JSDOM(`<html lang="en"><body><main><article>
    <a href="/someone/status/42">2:00 PM</a>
    <h1>Parts list</h1>
    <div class="x-article-body">
      <p>Stepper driver carrier, <a href="https://x.com/search?q=%248.95&amp;src=cashtag_click">$8.95</a> from <a href="https://x.com/pololu">@pololu</a>.</p>
      <p>Link: <a href="https://www.pololu.com/product/1182">https://www.pololu.com/product/1182</a></p>
      <p>Solder it <a href="https://t.co/xyz">youtube.com/watch?v=abc…</a> carefully.</p>
    </div>
  </article></main></body></html>`, { url: "https://x.com/someone/status/42" }).window.document
  const article = extractXPost(doc)
  assert.deepEqual(blocks(article), ["Stepper driver carrier, $8.95 from pololu.", "Solder it carefully."])
  assert.doesNotMatch(article.content, /Link:|pololu\.com|youtube/)
})

for (const view of ["in", "out"]) {
  test(`${view}: each paragraph of a post gets its own highlight range`, () => {
    const doc = load(`${view}-long`, LONG_URL)
    const read = blocks(extractXPost(doc, LONG_URL))
    const post = createAnchorFinder(doc)(read[0]!)!
    const second = blockRange(post, read[1]!, read[2])!.toString()
    assert.match(second, /^L’affaire secoue/)
    assert.doesNotMatch(second, /DIPLOMATIE|La date du 17/)
    assert.match(blockRange(post, read[0]!, read[1])!.toString(), /^DIPLOMATIE[^]*CAMEROUN\.\s*$/)
    assert.match(blockRange(post, read.at(-1)!)!.toString(), /rebondissements spectaculaires\./)
  })
}

test("X Article keeps a short line ending in a colon that lost no link", () => {
  const doc = new JSDOM(`<html lang="en"><body><main><article>
    <a href="/someone/status/42">2:00 PM</a>
    <h1>Learning plan</h1>
    <div class="x-article-body">
      <p>What you'll learn:</p>
      <ul><li>Kinematics</li></ul>
      <p>Link: https://example.com/course</p>
    </div>
  </article></main></body></html>`, { url: "https://x.com/someone/status/42" }).window.document
  const article = extractXPost(doc)
  assert.deepEqual(blocks(article), ["What you'll learn:", "Kinematics."])
})

test("X's non-language codes fall back to the page language", () => {
  for (const code of ["und", "qme", "qht", "zxx"]) {
    const doc = post("Un caporal chef n’est pas un sous-officier.")
    doc.querySelector("[data-testid='tweetText']")!.setAttribute("lang", code)
    assert.equal(extractXPost(doc).lang, "fr", code)
  }
})
