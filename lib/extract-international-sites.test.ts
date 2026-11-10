import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

function documentFor(body: string, url: string) {
  return new JSDOM(`<html lang="fr"><head><title>Comprendre la lecture et ses effets</title></head><body>${body}</body></html>`, { url }).window.document
}

const introduction = "La lecture permet de comprendre un sujet dans son ensemble. Elle relie les observations aux explications, puis présente les conséquences de ces découvertes pour la vie quotidienne. Chaque paragraphe apporte une information distincte et utile."
const conclusion = "Les recherches se poursuivent pour préciser ces résultats. Les équipes comparent plusieurs expériences indépendantes, confrontent leurs observations et publient leurs données afin que chacun puisse vérifier leurs conclusions et prolonger leur travail."

test("BBC conserve les blocs intermédiaires riches en liens, sans invitation newsletter", () => {
  // BBC's layout blocks nest prose in several divs. Legitimate citations can
  // exceed Readability's 20% link-density threshold for an unweighted div.
  const linked = "Les résultats sont détaillés dans les travaux de recherche consultables publiquement, avec des observations et des mesures vérifiables."
  const doc = documentFor(`<article>
    <div data-component="layout-block"><div><div><p>${introduction}</p></div></div></div>
    <div data-component="layout-block"><div><div>
      <h2>Que montrent les données intermédiaires ?</h2>
      <p>Les chercheurs étudient cette question depuis plusieurs années. <a href="/science">${linked}</a> Ils invitent à comparer les méthodes avant de tirer une conclusion.</p>
    </div></div></div>
    <div data-component="layout-block"><div><div><p>${conclusion}</p></div></div></div>
    <div data-component="layout-block"><div><p>Sign up for our Future Earth newsletter to receive regular updates. <a href="https://www.bbc.co.uk/newsletters/zdsgqyc">Read our newsletter</a>.</p></div></div>
  </article>`, "https://www.bbc.com/news/articles/example")

  const { textContent } = extractArticle(doc)

  assert.ok(textContent.includes(introduction))
  assert.ok(textContent.includes(linked))
  assert.match(textContent, /Que montrent les données intermédiaires/)
  assert.ok(textContent.includes(conclusion))
  assert.doesNotMatch(textContent, /Sign up|Read our newsletter/)
  assert.equal(doc.querySelector(".article-body"), null)
  assert.match(doc.body.textContent ?? "", /Sign up/)
})

test("Wikipédia conserve les titres emballés, sans appels de notes, références ni portails", () => {
  const citation = "Référence bibliographique sans utilité dans la lecture vocale. ".repeat(12)
  const doc = documentFor(`<main><div class="mw-parser-output">
    <p>${introduction}</p>
    <div class="mw-heading mw-heading2"><h2>Histoire de la lecture</h2><span class="mw-editsection">[<a href="?action=edit">modifier</a> | <a href="?action=edit">modifier le code</a>]</span></div>
    <p>Au IV<sup>e</sup> siècle, les pratiques de lecture évoluent. <sup class="mw-ref reference"><a href="#cite_note-1">[1]</a></sup>${introduction}</p>
    <div class="mw-heading mw-heading3"><h3>Lire en silence</h3><span class="mw-editsection">[<a href="?action=edit">modifier</a>]</span></div>
    <p>${conclusion}</p>
    <div class="mw-references-wrap"><ol class="mw-references references"><li>${citation}</li></ol></div>
    <ul id="bandeau-portail" class="bandeau-portail"><li>Portail de la culture</li></ul>
  </div></main>`, "https://fr.wikipedia.org/wiki/Lecture")

  const { textContent, content } = extractArticle(doc)

  assert.match(content, /<h2>Histoire de la lecture<\/h2>/)
  assert.match(content, /<h3>Lire en silence<\/h3>/)
  assert.match(content, /<sup>e<\/sup>/)
  assert.ok(textContent.includes(conclusion))
  assert.doesNotMatch(textContent, /modifier|\[1\]|Référence bibliographique|Portail de la culture/)
  assert.equal(doc.querySelectorAll(".mw-heading").length, 2)
})

test("Numerama exclut les encarts de consentement et de recommandations volumineux", () => {
  const consent = "Ce contenu est bloqué tant que vous ne choisissez pas vos préférences cookies. ".repeat(12)
  const related = "Découvrez aussi un autre article recommandé sur un sujet voisin. ".repeat(12)
  const doc = documentFor(`<article><div class="entry-content">
    <p>${introduction}</p>
    <h2>Une observation inattendue</h2>
    <p>${conclusion}</p>
    <div class="embed-consent-overlay"><div class="embed-consent-overlay-text"><p>${consent}</p></div></div>
    <div class="embedded-tag-container"><p>Tout comprendre à ce sujet</p><ul><li>${related}</li></ul></div>
  </div></article>`, "https://www.numerama.com/sciences/123456-observation.html")

  const { textContent } = extractArticle(doc)

  assert.ok(textContent.includes(introduction))
  assert.ok(textContent.includes(conclusion))
  assert.doesNotMatch(textContent, /contenu est bloqué|préférences cookies|Tout comprendre|autre article recommandé/)
})
