import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

const paragraphs = [
  "Cette page présente une synthèse des informations disponibles sur le sommeil. Elle explique les termes employés, décrit les questions étudiées par les chercheurs et distingue les observations générales des situations qui nécessitent une évaluation individuelle.",
  "Les explications reposent sur plusieurs documents de référence et sont organisées en sections pour faciliter la lecture. Les exemples permettent de comprendre le sujet, tandis que les encadrés précisent les limites des informations présentées dans le texte.",
  "La dernière section rassemble les questions fréquemment posées et indique les ressources qui complètent cette présentation. Le lecteur doit pouvoir retrouver ces éléments dans leur ordre, avec les réserves et les références associées à chaque explication.",
]

function extractUnchanged(doc: Document) {
  const before = doc.documentElement.outerHTML
  const article = extractArticle(doc)
  assert.equal(doc.documentElement.outerHTML, before)
  let cursor = 0
  for (const paragraph of paragraphs) {
    const offset = article.textContent.indexOf(paragraph, cursor)
    assert.ok(offset >= 0, "Chaque paragraphe éditorial reste présent dans l'ordre")
    cursor = offset + paragraph.length
  }
  return article.textContent
}

test("Harvard conserve l'encadré clinique et l'avertissement placé après le corps", () => {
  const warning = "No content on this site, regardless of date, ne remplace une évaluation clinique individuelle."
  const doc = new JSDOM(`<html lang="fr"><head><title>Comprendre le sommeil | Harvard Health</title></head><body>
    <article><div class="content-repository-content prose">
      ${paragraphs.map(text => `<p>${text}</p>`).join("")}
      <table class="Table"><tbody><tr><td><h3>Précautions de lecture clinique</h3>
        <p>Cet encadré précise les limites de la présentation.</p>
        <ul><li>Une réserve clinique importante à conserver.</li><li>Une seconde précaution complète l'explication.</li></ul>
      </td></tr></tbody></table>
    </div><div><div class="leading-prose font-serif"><p>Informations sur les archives du site.</p>
      <p class="font-semibold mt-2">${warning}</p>
    </div></div></article>
    <div class="newsletter">Une offre commerciale extérieure.</div>
  </body></html>`, { url: "https://www.health.harvard.edu/newsletter_article/understanding-sleep" }).window.document

  const text = extractUnchanged(doc)
  assert.match(text, /Précautions de lecture clinique/)
  assert.match(text, /Une réserve clinique importante à conserver/)
  assert.match(text, /Une seconde précaution complète l'explication/)
  assert.ok(text.endsWith(warning))
  assert.doesNotMatch(text, /offre commerciale/)
})

test("Psychology Today garde les réponses cliniques sans les cartes d'autres articles", () => {
  const doc = new JSDOM(`<html lang="fr"><head><title>Comprendre les difficultés de sommeil | Psychology Today</title></head><body>
    <article class="basics-full"><div class="reference__body"><div class="field-name-body"><p>${paragraphs[0]}</p></div></div>
      <div class="reference__sections"><h2>Questions fréquentes</h2>
        <div class="h3 faq--question">Comment lire cette synthèse ?</div>
        <div class="faq--answer"><p>${paragraphs[1]}</p><p>${paragraphs[2]}</p>
          <ul><li>Une limite clinique de l'interprétation.</li></ul>
        </div><div class="pt-ad">Une publicité à ne pas lire.</div>
      </div>
      <div class="views-element-container"><article class="teaser--card-inset-details"><div class="card-inset-details__teaser-text">${"Article connexe extérieur : cette carte propose un autre sujet et ne fait pas partie des réponses cliniques de la page. ".repeat(5)}</div></article></div>
    </article>
  </body></html>`, { url: "https://www.psychologytoday.com/us/basics/sleep-topic" }).window.document

  const text = extractUnchanged(doc)
  assert.match(text, /Questions fréquentes/)
  assert.match(text, /Comment lire cette synthèse/)
  assert.match(text, /Une limite clinique de l'interprétation/)
  assert.doesNotMatch(text, /Article connexe extérieur|publicité/)
})

test("Sleep Foundation garde résumé, réserves, FAQ et références sans cookies ni formulaires", () => {
  const doc = new JSDOM(`<html lang="fr"><head><title>Comprendre le sommeil et ses références | Sleep Foundation</title></head><body>
    <div id="cc-main"><div class="cm"><p id="cm__desc">${"Bannière de confidentialité : acceptez les cookies ou réglez vos préférences avant de poursuivre votre visite. ".repeat(5)}</p></div></div>
    <a href="#post_content">Skip to content</a>
    <div class="wrapper"><div id="post_content">
      <div class="blockquote-key-takeaways"><h2>Points essentiels</h2><ul><li>Un résumé clinique utile à la lecture.</li></ul></div>
      <div class="hst-cta"><h2>Offre commerciale de test à domicile</h2><p>Les conditions du tarif dépendent de la couverture et des services souscrits.</p></div>
      ${paragraphs.map(text => `<p>${text}</p>`).join("")}
      <div id="faq-section"><h2>Questions fréquentes</h2><p>Une réserve clinique nécessaire complète cette réponse.</p></div>
      <div class="email-capture"><h2>Inscrivez-vous aux offres</h2><form><input type="email" /></form></div>
    </div><div class="references-section"><h2>Références</h2><ol class="references-list">
      <li class="reference-list-item">Source bibliographique de la première section. <a href="https://example.org/source-one">Consulter la source un</a>.</li>
      <li class="reference-list-item">Source bibliographique de la seconde section. <a href="https://example.org/source-two">Consulter la source deux</a>.</li>
    </ol></div></div>
  </body></html>`, { url: "https://www.sleepfoundation.org/sleep-topic" }).window.document

  const text = extractUnchanged(doc)
  assert.match(text, /Points essentiels/)
  assert.match(text, /Un résumé clinique utile/)
  assert.match(text, /Une réserve clinique nécessaire/)
  assert.match(text, /Références/)
  assert.match(text, /Source bibliographique de la première section/)
  assert.match(text, /Consulter la source deux/)
  assert.doesNotMatch(text, /Bannière de confidentialité|Skip to content|Inscrivez-vous aux offres|Offre commerciale|conditions du tarif/)
})
