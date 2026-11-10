import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle, visibleText } from "./extract-article.ts"

const paragraphs = [
  "Un lecteur conserve les articles qui l'intéressent pour pouvoir les retrouver pendant ses déplacements. Il souhaite garder les explications complètes, les exemples du milieu du texte et la conclusion, même lorsque la page contient des encarts commerciaux.",
  "Les liens affiliés peuvent financer une publication sans modifier le contenu de ses articles. Cette phrase appartient à l'analyse éditoriale et doit rester lisible, contrairement à la mention commerciale ajoutée sous le corps par le site.",
  "Pour comparer les outils disponibles, les lecteurs consultent leurs fonctions et leurs possibilités de classement. Le choix dépend aussi des usages quotidiens et de la facilité à retrouver une information plusieurs semaines après sa première lecture.",
]

test("TechCrunch retire la mention affiliée extérieure au corps, sans couper la prose", () => {
  // Structure réduite de l'article Pocket audité : la mention est sœur de
  // .entry-content et Readability l'incluait avec le contenu éditorial.
  const doc = new JSDOM(`<html lang="fr"><head><title>Comparer les outils de lecture | TechCrunch</title></head><body>
    <div class="wp-block-column">
      <div class="entry-content wp-block-post-content">
        ${paragraphs.map(text => `<p>${text}</p>`).join("")}
      </div>
      <p class="affiliate-disclaimer-text wp-block-paragraph"><em>Lorsque vous achetez par nos liens, nous recevons une commission commerciale.</em></p>
    </div>
  </body></html>`, { url: "https://techcrunch.com/2026/08/14/reading-tools/" }).window.document

  const { textContent } = extractArticle(doc)

  for (const paragraph of paragraphs) assert.ok(textContent.includes(paragraph))
  assert.doesNotMatch(textContent, /commission commerciale/)
})

test("The Verge garde tous les composants éditoriaux sans biographie ni invitation à suivre", () => {
  // Les composants de prose sont explicites ; bio et invitation les entourent
  // sous .duet--layout--entry-body, avec seulement des classes générées.
  const doc = new JSDOM(`<html lang="fr"><head><title>Comparer les outils de lecture | The Verge</title></head><body>
    <article><h1>Comparer les outils de lecture</h1>
      <div class="duet--layout--entry-body">
        <div class="duet--ledes--standard-lede-bottom"><div class="_4aoxp30"><span>Camille connaît les logiciels musicaux et présente la biographie de l'auteur. Ses années de journalisme lui permettent d'écrire sur des sujets très variés.</span></div></div>
        <div class="_1044qiz13">
          <div class="duet--article--article-body-component"><p>${paragraphs[0]}</p></div>
          <div class="duet--article--article-body-component"><h2>Financer une publication</h2><p>${paragraphs[1]}</p></div>
          <div class="duet--article--article-body-component"><p>${paragraphs[2]}</p></div>
          <div class="tly2fw0"><span>Suivez les sujets et les auteurs de cet article pour recevoir leurs nouveautés dans votre fil personnalisé.</span><div>Camille</div></div>
        </div>
      </div>
    </article>
  </body></html>`, { url: "https://www.theverge.com/tech/123/reading-tools" }).window.document
  const before = doc.documentElement.outerHTML

  const { textContent } = extractArticle(doc)

  for (const paragraph of paragraphs) assert.ok(textContent.includes(paragraph))
  assert.match(textContent, /Financer une publication/)
  assert.doesNotMatch(textContent, /biographie|Suivez les sujets|Camille/)
  assert.equal(doc.documentElement.outerHTML, before)
})

test("Quora ne lit pas la vérification Cloudflare par le repli texte", () => {
  // Le challenge rendu n'a pas #cf-error-details ; les classes sont générées.
  const doc = new JSDOM(`<html lang="en"><head><title>Just a moment...</title></head><body>
    <div class="main-wrapper"><h1>www.quora.com</h1><h2>Performing security verification</h2>
      ${Array.from({ length: 6 }, () => "<div>Une vérification est en cours. Patientez pendant que le service contrôle votre navigateur avant de charger la page demandée.</div>").join("")}
      <span id="challenge-error-text">Cette vérification prend plus de temps que prévu.</span>
    </div><div class="footer">Performance and Security by Cloudflare</div>
  </body></html>`, { url: "https://www.quora.com/What-is-reading" }).window.document

  assert.throws(() => extractArticle(doc), /article lisible/)
  assert.equal(visibleText(doc).text, "")
})
