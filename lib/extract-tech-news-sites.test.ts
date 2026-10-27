import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

// Prose synthétique dans les structures constatées sur les articles audités.
const TITLE = "How researchers preserve historical maps for future readers"
const PROSE = [
  "Researchers examine each historical map before choosing a treatment. They photograph damaged areas, record the remaining colors and describe the notes that readers added over several generations. These records explain why each repair is necessary.",
  "The team cleans the paper carefully and repairs tears using compatible materials. Every decision is documented so future conservators can distinguish the original paper from later additions and understand the choices made during restoration.",
  "The restored maps will return to protective boxes in a room with stable temperature and humidity. Visitors can compare the results with photographs taken before treatment, while researchers can consult the detailed records prepared by the team.",
]
const HEADING = "Preserving the evidence left by readers"
const QUOTE = "A small annotation can explain how a document was used."
const BODY = `<p>${PROSE[0]}</p><h2>${HEADING}</h2><p>${PROSE[1]}</p>
  <blockquote><p>${QUOTE}</p></blockquote><p>${PROSE[2]}</p>`
const BODY_ORDER = [PROSE[0], HEADING, PROSE[1], QUOTE, PROSE[2]]

function extractAt(host: string, html: string) {
  const doc = new JSDOM(`<!doctype html><html lang="en"><head><title>${TITLE}</title></head>
    <body>${html}</body></html>`, { url: `https://www.${host}/news/historical-maps` }).window.document
  const original = doc.documentElement.outerHTML
  const article = extractArticle(doc)
  assert.equal(doc.documentElement.outerHTML, original, "source DOM remains unchanged")
  return article.textContent
}

function assertOrder(text: string, blocks: string[]) {
  let previous = -1
  for (const block of blocks) {
    const position = text.indexOf(block)
    assert.ok(position > previous, `missing or reordered block: ${block}`)
    previous = position
  }
}

test("ZDNET conserve chapeau, légende et liste sans les renvois promotionnels", () => {
  const lead = "Museum teams are sharing the methods they use to repair historical maps without erasing the evidence left by earlier readers."
  const credit = "Museum archive / Research desk"
  const takeaways = ["Document damage before treatment.", "Preserve handwritten notes.", "Record every repair."]
  const text = extractAt("zdnet.com", `<article>
    <header class="entry-header"><h1>${TITLE}</h1><p class="entry-excerpt">${lead}</p></header>
    <div class="entry-content">
      <figure class="wp-block-image is-content-hero"><img src="/map.jpg" alt="A historical map">
        <figcaption><p></p><span class="zd-image-credit">${credit}</span></figcaption></figure>
      <p><em>Follow ZDNET: </em><a href="https://cc.zdnet.com/v1/otc/example?url=https%3A%2F%2Fwww.google.com%2Fpreferences%2Fsource%3Fq%3Dzdnet.com">Add us as a preferred source on Google.</a></p>
      <h3>ZDNET key takeaways</h3><ul>${takeaways.map(text => `<li>${text}</li>`).join("")}</ul>
      ${BODY}<p><strong>Also:</strong> <a href="/another-article/">Another unrelated guide for readers.</a></p>
      <div class="wp-block-ziff-davis-exco-video"><p>More from ZDNET</p></div>
    </div></article>`)

  assertOrder(text, [lead, credit, "ZDNET key takeaways", ...takeaways, ...BODY_ORDER])
  assert.doesNotMatch(text, /Follow ZDNET|preferred source|Another unrelated guide|More from ZDNET/)
})

test("CNET conserve le chapeau et les deux légendes dans l'ordre du document", () => {
  const lead = "The colors on historical maps reveal how their makers understood the world. Researchers explain what happens when those pigments begin to fade."
  const hero = "A painted map before restoration, with its original annotations still visible."
  const inline = "The same map after its damaged paper was repaired."
  const text = extractAt("cnet.com", `<article>
    <div class="single-page__content"><header class="entry-header"><h1>${TITLE}</h1>
      <p class="entry-excerpt">${lead}</p></header>
      <figure class="post-thumbnail alignwide"><img src="/before.jpg" alt="Before restoration"><figcaption>${hero}</figcaption></figure>
    </div>
    <div class="entry-content">${BODY}
      <figure class="wp-block-image"><img src="/after.jpg" alt="After restoration"><figcaption class="wp-element-caption">${inline}</figcaption></figure>
      <div class="wp-block-ziff-davis-exco-video"><p>More from CNET</p></div>
    </div></article>`)

  assertOrder(text, [lead, hero, ...BODY_ORDER, inline])
  assert.doesNotMatch(text, /More from CNET/)
})

test("The Next Web conserve l'introduction et termine avant l'inscription newsletter", () => {
  const lead = "A museum research team has developed a new method for studying historical maps while preserving their original paper and handwritten notes."
  const credit = "Credit: Museum archive"
  const text = extractAt("thenextweb.com", `<header class="c-header"><h1>${TITLE}</h1>
    <p class="c-header__intro">${lead}</p></header>
    <article id="articleOutput" class="c-article">
      <div class="c-article__media"><figure><img src="/map.jpg" alt="A historical map"><figcaption class="c-article__figcaption">${credit}</figcaption></figure></div>
      <div class="c-article__main">
      <div id="article-main-content" class="c-richText c-richText--large">${BODY}</div>
      <div class="c-channel__cta" id="nl-container"><h2>Get the TNW newsletter</h2>
        <p>Get the most important tech news in your inbox each week.</p></div>
    </div></article>`)

  assertOrder(text, [lead, credit, ...BODY_ORDER])
  assert.ok(text.endsWith(PROSE[2]))
  assert.doesNotMatch(text, /Get the TNW newsletter|in your inbox each week/)
})

test("Mashable garde les citations réelles sans placeholders, newsletter ni biographie", () => {
  const lead = "Restoring an old map takes patience, careful records and a willingness to preserve the marks left by its readers."
  const caption = "A historical map before restoration."
  const credit = "Credit: Museum archive"
  const tweet = "The team will publish its complete restoration records so other museums can study the method."
  const bio = "This author biography describes previous jobs, personal interests and published books rather than the historical maps discussed in the article. The writer has worked for several magazines and now edits reports about technology and culture. "
  const placeholder = "This Tweet is currently unavailable. It might be loading or has been removed."
  const text = extractAt("mashable.com", `<article>
    <div class="mx-auto max-w-5xl"><header><h1>${TITLE}</h1><div class="mt-2 leading-tight">${lead}</div></header>
      <div class="max-w-7xl px-4 mt-10"><img src="/map.jpg" alt="A historical map">
        <div class="mt-2 leading-none text-left"><span class="font-sans normal-case subtitle-2 text-gray-1000">${caption}</span>
          <span class="font-sans subtitle-2 text-gray-600">${credit}</span></div>
      </div>
    </div>
    <section class="editor-content" id="article">${BODY}
      <blockquote class="twitterEmbed twitter-tweet"><p>${tweet}</p></blockquote>
      <blockquote class="twitterEmbed twitter-tweet">${placeholder}</blockquote>
      <blockquote class="twitterEmbed twitter-tweet">${placeholder}</blockquote>
      <p><em>Want more tech and digital culture news delivered to your inbox daily or sent straight to your device? Sign up for Mashable's <a href="https://mashable.com/newsletters">Top Stories newsletter</a></em><em> or <a href="https://mashable.com/life/how-to-set-up-mashable-push-notifications">get Mashable push alerts</a> today.</em></p>
    </section>
    <section><div class="py-8"><div class="editor-content"><p>${bio.repeat(3)}</p></div></div></section>
  </article>`)

  assertOrder(text, [lead, caption, credit, ...BODY_ORDER, tweet])
  assert.doesNotMatch(text, /This Tweet is currently unavailable|Top Stories newsletter|Mashable push alerts|This author biography/)
})
