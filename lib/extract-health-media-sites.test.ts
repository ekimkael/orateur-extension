import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

const introduction = "Cet article présente une recherche et explique comment les auteurs interprètent leurs observations. Il décrit la méthode employée, les limites des résultats et les points qui nécessitent encore une vérification indépendante avant de tirer une conclusion générale."
const warning = "Cette section précise les limites de l'article et indique dans quelles situations demander un avis professionnel. Ces précautions appartiennent au contenu principal et doivent rester présentes dans une lecture complète, avec les explications qui les accompagnent."
const conclusion = "Les auteurs demandent des études complémentaires et rappellent que les observations ne répondent pas encore à toutes les questions. Ils décrivent les incertitudes restantes afin que les lecteurs comprennent la portée exacte des résultats présentés."

function documentFor(body: string, host: string) {
  return new JSDOM(`<html lang="fr"><head><title>Comprendre les observations et leurs limites</title></head><body>${body}</body></html>`, { url: `https://www.${host}/articles/example` }).window.document
}

for (const host of ["healthline.com", "medicalnewstoday.com"]) {
  test(`${host} conserve titres, paragraphes et listes riches en liens avec les précautions`, () => {
    const linked = "Les liens vers les études permettent de vérifier les observations et les limites de la méthode employée."
    const doc = documentFor(`<main><article class="article-body css-1exq1ob">
      <div class="css-clxyy9"><p>${introduction}</p></div>
      <div data-testid="tabbed-article-section" class="css-1xdhyk6">
        <h2><div><a class="chartbeat-section" name="limits">Les limites et les précautions</a></div></h2>
        <div><p>Voici les éléments documentés dans <a href="https://example.org/study">${linked}<span class="icon-hl-trusted-source-after"><span class="sro">Trusted Source</span></span></a> : </p></div>
        <div><ul><li><a href="https://example.org/one">Première situation documentée</a></li><li><a href="https://example.org/two">Deuxième situation documentée</a></li></ul></div>
        <div><p>${warning}</p></div>
      </div>
      <div class="css-1xdhyk6"><h2><div><a class="chartbeat-section" name="conclusion">Les questions encore ouvertes</a></div></h2><p>${conclusion}</p></div>
    </article></main>`, host)

    const { textContent, content } = extractArticle(doc)

    for (const paragraph of [introduction, linked, warning, conclusion]) assert.ok(textContent.includes(paragraph))
    assert.match(textContent, /Les limites et les précautions/)
    assert.match(textContent, /Les questions encore ouvertes/)
    assert.match(textContent, /Première situation documentée/)
    assert.match(textContent, /Deuxième situation documentée/)
    assert.match(content, /href="https:\/\/example\.org\/study"/)
    assert.doesNotMatch(textContent, /Trusted Source/)
    assert.equal(doc.querySelectorAll("a.chartbeat-section").length, 2)
  })
}

test("Medical News Today garde la citation et son attribution sans l'interface Pinterest", () => {
  const quote = "Cette citation explique les observations en précisant leur contexte. Elle rappelle que les différentes approches décrites doivent être considérées ensemble et que l'article présente des informations à interpréter avec leurs limites, sans en supprimer les nuances."
  const doc = documentFor(`<main>
    <figure><a class="icon-hl-pinterest" href="https://www.pinterest.com/pin/create/button/"><span>Share on Pinterest</span></a><figcaption>Légende de l'illustration de recherche.</figcaption></figure>
    <article class="article-body css-1exq1ob">
      <div class="css-clxyy9"><p>${introduction}</p></div>
      <div data-testid="tabbed-article-section" class="css-1xdhyk6"><h2><div><a class="chartbeat-section" name="quote">Comment interpréter les résultats</a></div></h2>
        <div><blockquote class="is-layout-flow wp-block-quote-is-layout-flow"><p>${quote}</p><cite>– Camille Martin, chercheuse</cite></blockquote></div>
        <p>${warning}</p>
      </div><div><p>${conclusion}</p></div>
    </article>
  </main>`, "medicalnewstoday.com")

  const { textContent } = extractArticle(doc)

  assert.ok(textContent.includes(quote))
  assert.match(textContent, /Camille Martin, chercheuse/)
  assert.ok(textContent.includes(warning))
  assert.doesNotMatch(textContent, /Share on Pinterest/)
})

test("WebMD conserve précautions, listes et références documentaires sans la promotion Google", () => {
  const firstSource = "Source primaire : étude décrivant la méthode, les résultats et les limites des observations présentées dans cet article."
  const secondSource = "Source complémentaire : document de référence décrivant les précautions et les conditions d'interprétation de ces résultats."
  const doc = documentFor(`<article class="article medref viewport_ads"><div class="inner-article-container">
    <div class="article__body"><div class="article-page active-page"><section><h2 class="jumplink-headers">Les précautions à retenir</h2><p>${introduction}</p><p>${warning}</p><ul><li>Première précaution documentée</li><li>Deuxième précaution documentée</li></ul><p>${conclusion}</p></section></div></div>
    <footer><div class="article__publication-sources"><section class="asset-footer"><div class="asset-footer-content"><div class="sources-section" style="display:none"><div class="sources-wrapper"><p><a href="https://example.org/primary">${firstSource}</a></p><p><a href="https://example.org/reference">${secondSource}</a></p></div></div></div></section></div></footer>
    <div class="google-preferences-module"><p class="google-info-text">Add WebMD as a <a href="https://www.google.com/preferences/source?q=webmd.com">Preferred Source</a> to see more of our trusted content across Google Search and AI Overviews.</p></div>
  </div></article>`, "webmd.com")

  const { textContent, content } = extractArticle(doc)

  for (const paragraph of [introduction, warning, conclusion, firstSource, secondSource]) assert.ok(textContent.includes(paragraph))
  assert.match(textContent, /Première précaution documentée/)
  assert.match(textContent, /Deuxième précaution documentée/)
  assert.match(content, /href="https:\/\/example\.org\/primary"/)
  assert.doesNotMatch(textContent, /Preferred Source|AI Overviews/)
  assert.ok(doc.querySelector("footer .sources-section"))
})
