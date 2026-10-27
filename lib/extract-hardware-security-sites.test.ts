import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

const lead = "Cette enquête explique le fonctionnement de cette technologie et les conséquences de son utilisation. Les observations proviennent de plusieurs expériences indépendantes, comparées entre elles afin de mieux comprendre les résultats et leurs limites."
const middle = "Les chercheurs ont réalisé plusieurs mesures pour vérifier leur hypothèse. Ils ont comparé les performances dans différentes conditions et décrit les étapes de leur méthode, afin que d'autres équipes puissent reproduire ces expériences et discuter leurs conclusions."
const ending = "Les prochaines expériences permettront de préciser ces observations. Les équipes souhaitent publier davantage de données, améliorer leurs méthodes et expliquer comment cette technologie pourrait répondre aux besoins des personnes qui l'utilisent au quotidien."

function documentFor(body: string, host: string, title = "Comprendre cette technologie et son fonctionnement", metadata = "") {
  return new JSDOM(`<html lang="fr"><head><title>${title}</title>${metadata}</head><body>${body}</body></html>`, { url: `https://www.${host}/article/example` }).window.document
}

test("TechRadar garde les deux sous-titres lorsque le titre social diffère du titre visible", () => {
  const title = "How does this portable computer work, and is it safe to leave charging?"
  const socialTitle = "Explained: how this portable computer works, and how potentially dangerous its battery is when charging"
  const biography = "Biographie de la journaliste, qui travaille dans plusieurs rédactions. ".repeat(10)
  const quiz = "Reset your password. Please enter your new password below. ".repeat(10)
  const doc = documentFor(`<article>
    <div class="widget widget-hero"><header><h1>${title}</h1></header></div>
    <div id="article-body" class="text-copy bodyCopy auto">
      <p>${lead}</p><h2>How does this portable computer work?</h2><p>${middle}</p>
      <h2>Is the portable computer safe to leave charging?</h2><p>${ending}</p>
      <div class="kwizly-quiz"><div class="kwizly-poll"><div class="kwizly-overlay"><p>${quiz}</p></div></div></div>
      <p><a href="https://news.google.com/publications/example">Follow TechRadar on Google News</a> and add us as a preferred source.</p>
    </div>
    <div class="author"><div class="author__bio-wrapper"><div class="author__biography"><p>${biography}</p></div></div></div>
  </article>`, "techradar.com", title, `<meta property="og:title" content="${socialTitle}">`)

  const result = extractArticle(doc)

  assert.equal(result.title, title)
  assert.match(result.content, /<h2>How does this portable computer work\?<\/h2>/)
  assert.match(result.content, /<h2>Is the portable computer safe to leave charging\?<\/h2>/)
  for (const paragraph of [lead, middle, ending]) assert.ok(result.textContent.includes(paragraph))
  assert.doesNotMatch(result.textContent, /Biographie de la journaliste|Reset your password|preferred source/)
  assert.equal(doc.querySelector("meta[property='og:title']")?.getAttribute("content"), socialTitle)
  assert.ok(doc.querySelector(".widget-hero h1"))
})

test("PCWorld conserve le chapeau dans un header distinct et exclut la commission commerciale", () => {
  const subheadline = "Les observations changent notre manière de lire."
  const doc = documentFor(`<main>
    <div class="article-hero"><div class="affiliate-disclaimer"><p>When you purchase through links in our articles, we may earn a small commission. This does not affect our editorial independence.</p></div></div>
    <article>
      <header class="article-column"><div class="article-column__content"><div class="core"><h2 class="content-subheadline">${subheadline}</h2></div></div></header>
      <div class="article-column for-toc"><div class="article-column__content"><p class="wp-block-paragraph">${middle}</p></div></div>
      <div class="article-column for-toc"><div class="article-column__content"><p class="wp-block-paragraph">${ending}</p></div></div>
    </article>
  </main>`, "pcworld.com")

  const { textContent } = extractArticle(doc)

  for (const paragraph of [subheadline, middle, ending]) assert.ok(textContent.includes(paragraph))
  assert.ok(textContent.indexOf(subheadline) < textContent.indexOf(middle))
  assert.doesNotMatch(textContent, /small commission|editorial independence/)
  assert.ok(doc.querySelector("header .content-subheadline"))
})

test("How-To Geek exclut la biographie placée avant le vrai corps", () => {
  const biography = "Biographie de la journaliste spécialisée dans les outils informatiques. ".repeat(8)
  const doc = documentFor(`<article class="w-article widget article layout-rich">
    <div class="article-header-data"><div class="with-excerpt" data-nosnippet><p>${biography}</p></div></div>
    <section id="article-body" class="article-body"><p>${lead}</p><h2>Les mesures intermédiaires</h2><p>${middle}</p><p>${ending}</p></section>
  </article>`, "howtogeek.com")

  const { textContent } = extractArticle(doc)

  for (const paragraph of [lead, middle, ending]) assert.ok(textContent.includes(paragraph))
  assert.match(textContent, /Les mesures intermédiaires/)
  assert.doesNotMatch(textContent, /Biographie de la journaliste/)
})

function tomsDocument(options: { layout?: boolean; css?: string; barrier?: string } = {}) {
  const doc = documentFor(`<article>
    <header><p class="strapline">Une surface souple mesure les mouvements.</p></header>
    <div id="article-body" class="text-copy bodyCopy auto paywall-locker">
      <p>${lead}</p><p>${middle}</p>
      <p class="kiosq-b" aria-hidden="true" style="display:block;visibility:visible;opacity:1;${options.css ?? ""}">${ending}</p>
      <p><a href="https://news.google.com/publications/example">Follow our publication on Google News</a> and add us as a preferred source to receive our recent articles, technical analysis, and detailed reviews in your feeds.</p>
    </div>
    ${options.barrier === "layer" ? '<div class="kiosq-main-layer">Accès réservé</div>' : ""}
  </article>`, "tomshardware.com")
  if (options.barrier === "class") doc.body.classList.add("hasBarrier")
  if (options.layout !== false) {
    Object.defineProperty(doc.querySelector(".kiosq-b"), "getClientRects", { value: () => [{ width: 600, height: 144 }] })
  }
  return doc
}

test("Tom's Hardware conserve les paragraphes mesurés visibles malgré une balise aria-hidden périmée", () => {
  const doc = tomsDocument()

  const { textContent } = extractArticle(doc)

  assert.ok(textContent.includes(ending))
  assert.match(textContent, /Une surface souple mesure les mouvements/)
  assert.doesNotMatch(textContent, /preferred source/)
  assert.equal(doc.querySelector(".kiosq-b")?.getAttribute("aria-hidden"), "true")
})

test("Tom's Hardware respecte les barrières actives et les paragraphes sans visibilité prouvée", () => {
  for (const options of [
    { barrier: "class" },
    { barrier: "layer" },
    { layout: false },
    { css: "display:none" },
    { css: "visibility:hidden" },
    { css: "opacity:0" },
    { css: "filter:blur(3px)" },
  ]) {
    const { textContent } = extractArticle(tomsDocument(options))
    assert.ok(!textContent.includes(ending), JSON.stringify(options))
    assert.ok(textContent.includes(lead))
    assert.ok(textContent.includes(middle))
  }
})
