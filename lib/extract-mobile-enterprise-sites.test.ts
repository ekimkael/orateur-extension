import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

const paragraphs = [
  "Le fabricant publie les caractéristiques de son nouvel appareil dans un document technique destiné aux utilisateurs. Les informations précisent sa capacité de stockage, ses dimensions et les principales différences avec les modèles de la génération précédente.",
  "Ces caractéristiques permettent de comparer les appareils selon les usages quotidiens. Une batterie plus grande peut offrir davantage d'autonomie, mais les résultats dépendent aussi de la luminosité de l'écran et des applications utilisées pendant la journée.",
  "Les premiers essais indépendants permettront de vérifier les performances annoncées dans des conditions réelles. Ils complèteront les documents officiels et aideront les utilisateurs à choisir un modèle qui correspond à leurs besoins et à leur budget.",
]

function assertArticle(doc: Document, noise: RegExp) {
  const before = doc.documentElement.outerHTML
  const { textContent } = extractArticle(doc)
  let cursor = 0
  for (const paragraph of paragraphs) {
    const offset = textContent.indexOf(paragraph, cursor)
    assert.ok(offset >= 0, "Chaque paragraphe reste présent dans l'ordre")
    cursor = offset + paragraph.length
  }
  assert.doesNotMatch(textContent, noise)
  assert.equal(doc.documentElement.outerHTML, before)
}

test("MacRumors ne joint pas les cartes extérieures à un article court", () => {
  const doc = new JSDOM(`<html lang="fr"><head><title>La capacité du nouvel appareil | MacRumors</title></head><body><main>
    <article class="article--example js-article"><h1>La capacité du nouvel appareil</h1>
      <div class="js-content"><div class="ugc--example">${paragraphs.map(text => `<p>${text}</p>`).join("")}</div>
        <div class="linkback">Retrouvez les discussions associées sur le forum des lecteurs.</div>
      </div>
    </article>
    <div class="block--example excerpt--example"><div class="textRow--example">${"Autre article recommandé : ces informations concernent un autre produit et ne font pas partie du sujet sélectionné par le lecteur. ".repeat(4)}</div></div>
    <div class="block--example excerpt--example"><div class="textRow--example">${"Troisième article recommandé : ce résumé appartient à une carte de navigation placée sous le véritable article de la page. ".repeat(4)}</div></div>
  </main></body></html>`, { url: "https://www.macrumors.com/2026/10/18/device-capacity/" }).window.document

  assertArticle(doc, /Autre article recommandé|Troisième article recommandé|discussions associées/)
})

test("XDA retire la biographie de l'en-tête en conservant le résumé et les citations", () => {
  const doc = new JSDOM(`<html lang="fr"><head><title>Les caractéristiques du nouvel appareil | XDA</title></head><body>
    <article class="w-article article layout-rich"><div class="article-header-data">
      <div class="with-excerpt" data-nosnippet>${"Biographie de Camille : elle teste les ordinateurs et les téléphones depuis de nombreuses années et présente ici son parcours professionnel. ".repeat(5)}</div>
    </div><section id="article-body" class="article-body"><div class="content-block-regular">
      <h3>Résumé</h3><ul><li>Un document technique précise les caractéristiques.</li></ul>
      ${paragraphs.map(text => `<p>${text}</p>`).join("")}
      <blockquote><p>Les premiers essais complèteront les données du fabricant.</p></blockquote>
    </div></section></article>
  </body></html>`, { url: "https://www.xda-developers.com/new-device-details/" }).window.document

  assertArticle(doc, /Biographie de Camille|parcours professionnel/)
  const { textContent } = extractArticle(doc)
  assert.match(textContent, /Résumé/)
  assert.match(textContent, /Un document technique précise les caractéristiques/)
  assert.match(textContent, /Les premiers essais complèteront les données du fabricant/)
})

test("Android Central retire la carte auteur après la conclusion", () => {
  const doc = new JSDOM(`<html lang="fr"><head><title>Comprendre les caractéristiques du nouvel appareil | Android Central</title><meta name="author" content="Julien" /></head><body>
    <article><div id="article-body"><h2>Les points à retenir</h2>
      ${paragraphs.map(text => `<p>${text}</p>`).join("")}
    </div><div class="author author__default-layout author--collapsible" data-author-bio-max-height="250">
      <div class="author__header"><div class="author__role">Contributeur</div></div>
      <div class="author__bio-wrapper"><div class="author__biography"><p>${"Biographie de Julien : passionné par les smartphones, il écrit sur les technologies et aime présenter ses loisirs après les essais. ".repeat(4)}</p></div></div>
    </div></article>
  </body></html>`, { url: "https://www.androidcentral.com/phones/new-device-details" }).window.document

  assertArticle(doc, /Biographie de Julien|Contributeur|ses loisirs/)
})
