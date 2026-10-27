import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle, visibleText } from "./extract-article.ts"

test("WIRED conserve le paragraphe accessible sans lire le mur d'abonnement", () => {
  // Structure du mur observé sur l'article consacré aux transistors : le site
  // livre un paragraphe puis remplace le reste par une offre commerciale.
  const accessible = "Un transistor permet de commander le passage du courant dans un circuit. Ce composant a transformé la conception des appareils électroniques, depuis les premiers calculateurs jusqu'aux téléphones actuels. Pour comprendre son fonctionnement, il faut examiner les propriétés électriques des matériaux qui le composent."
  const doc = new JSDOM(`<html lang="fr"><head><title>Comprendre les transistors | WIRED</title></head><body>
    <article class="article main-content story"><h1>Comprendre les transistors</h1>
      <div class="body body__container article__body" data-testid="BodyWrapper">
        <div class="body__inner-container"><p>${accessible}</p></div>
        <div class="journey-unit__container">
          <div class="InContentBarrierContainer-iFMoPk"><div>Vous avez lu votre dernier article gratuit.</div>
            <div>${"Abonnez-vous pour recevoir nos offres et nos lettres d'information premium. ".repeat(6)}</div>
            <a href="/subscribe">Commencer l'essai gratuit</a>
          </div><div>Déjà abonné ? Connectez-vous.</div>
        </div>
      </div>
    </article>
  </body></html>`, { url: "https://www.wired.com/story/understanding-transistors/" }).window.document
  const before = doc.documentElement.outerHTML

  const article = extractArticle(doc)
  assert.ok(article.textContent.includes(accessible))
  for (const text of [article.textContent, visibleText(doc).text]) {
    assert.doesNotMatch(text, /dernier article gratuit|Abonnez-vous|essai gratuit|Connectez-vous/)
  }
  assert.equal(doc.documentElement.outerHTML, before)
})

test("WIRED garde les paragraphes éditoriaux courts portant la classe paywall", () => {
  // Classe présente sur la prose réellement affichée de l'article Artemis II.
  // Le filtre de bruit supprimait seulement les paragraphes de moins de 400
  // caractères, créant des trous au milieu d'un article accessible.
  const paragraphs = [
    "L'agence spatiale publie les données recueillies pendant sa dernière mission. Ces documents comprennent des photographies, des observations et des mesures destinées aux équipes de recherche qui souhaitent mieux comprendre la surface de la Lune.",
    "Trois rapports présentent les premières conclusions de la mission et expliquent les méthodes employées. Ils décrivent aussi le classement des fichiers et les précautions nécessaires pour interpréter les observations et comparer les mesures entre elles.",
    "Les chercheurs peuvent consulter les archives et télécharger les fichiers pour les analyser avec leurs propres logiciels. Les observations serviront à préparer les prochaines missions, en tenant compte des difficultés de navigation et de l'éclairage près des régions polaires. ".repeat(2),
    "Une présentation moins technique permet au public de découvrir les photographies et les échanges enregistrés à bord du vaisseau. Cette ressource complète les rapports scientifiques et rend les résultats de la mission plus faciles à explorer.",
  ]
  const doc = new JSDOM(`<html lang="fr"><head><title>Les archives de la mission lunaire | WIRED</title></head><body>
    <article><h1>Les archives de la mission lunaire</h1><div class="body__inner-container">
      <p>La mission ouvre ses archives aux scientifiques et au public.</p>
      ${paragraphs.map(text => `<p class="paywall">${text.trim()}</p>`).join("")}
    </div></article>
  </body></html>`, { url: "https://www.wired.com/story/lunar-mission-archives/" }).window.document
  const before = doc.documentElement.outerHTML

  for (const text of [extractArticle(doc).textContent, visibleText(doc).text]) {
    let cursor = 0
    for (const paragraph of paragraphs) {
      const offset = text.indexOf(paragraph.trim(), cursor)
      assert.ok(offset >= 0, "Chaque paragraphe éditorial reste présent dans l'ordre")
      cursor = offset + paragraph.trim().length
    }
  }
  assert.equal(doc.documentElement.outerHTML, before)
})
