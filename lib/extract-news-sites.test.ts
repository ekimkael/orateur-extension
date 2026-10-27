import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

// Prose synthétique ; structures observées dans des articles publics des trois CMS.
const TITLE = "Comment restaurer les cartes anciennes sans effacer leur histoire"
const PROSE = [
  "Dans les réserves du musée, les restaurateurs examinent chaque carte avant de commencer leur travail. Ils photographient les déchirures, relèvent les couleurs et décrivent les traces laissées par les lecteurs au fil des siècles.",
  "Une carte ne retrouve pas son état initial en quelques heures. Le papier doit être nettoyé avec précaution, puis consolidé avec des matériaux compatibles. Chaque intervention est documentée pour que les équipes suivantes puissent comprendre les choix effectués.",
  "Les inscriptions ajoutées dans les marges sont parfois aussi précieuses que le dessin principal. Elles témoignent des voyages, des échanges et des erreurs de leurs propriétaires. Les conserver permet de raconter une histoire que les catalogues ne mentionnent pas toujours.",
  "Après plusieurs semaines de travail, les documents sont placés dans des boîtes adaptées et conservés à température stable. Les visiteurs pourront découvrir les cartes restaurées lors d'une exposition accompagnée de leurs photographies avant intervention.",
]
const HEADING = "Conserver les traces des lecteurs"
const QUOTE = "Chaque trace nous renseigne sur la vie du document."
const BODY = `${PROSE.slice(0, 2).map(text => `<p>${text}</p>`).join("")}
  <h2>${HEADING}</h2><blockquote><p>${QUOTE}</p></blockquote>
  ${PROSE.slice(2).map(text => `<p>${text}</p>`).join("")}`

function documentAt(host: string, html: string) {
  return new JSDOM(`<!doctype html><html lang="fr"><head><title>${TITLE}</title></head>
    <body>${html}</body></html>`, { url: `https://www.${host}/culture/article-restauration` }).window.document
}

function assertBody(text: string) {
  for (const paragraph of [...PROSE, HEADING, QUOTE]) assert.ok(text.includes(paragraph), paragraph)
}

test("France 24 conserve le chapeau placé hors du corps et retire les renvois intégrés", () => {
  const lead = "Pour préserver les cartes anciennes, les musées associent recherche historique et gestes de restauration. Une équipe explique comment elle protège les couleurs et les annotations tout en permettant au public de consulter ces documents fragiles."
  const doc = documentAt("france24.com", `
    <div class="t-content t-content--article">
      <h1 class="t-content__title">${TITLE}</h1><p class="t-content__chapo">${lead}</p>
      <div class="t-content__with-sidebar"><div class="t-content__beside-sidebar">
        <div class="t-content__body u-clearfix">${BODY}
          <p class="a-read-more"><span class="a-read-more__label">À lire aussi</span><a href="/ailleurs">Un autre musée prépare sa saison.</a></p>
          <div class="m-em-video"><p>Le reportage vidéo consacré à une autre exposition.</p></div>
        </div>
      </div></div>
    </div>`)

  const { textContent } = extractArticle(doc)
  assert.ok(textContent.startsWith(lead))
  assertBody(textContent)
  assert.doesNotMatch(textContent, /À lire aussi|autre musée|reportage vidéo/)
})

test("Jeune Afrique conserve le chapeau et ignore les métadonnées destinées à l'impression", () => {
  const lead = "Le musée ouvre ses réserves pour expliquer la restauration des cartes anciennes. Des spécialistes racontent comment ils choisissent les documents à traiter et préservent les annotations qui témoignent de leur histoire."
  const doc = documentAt("jeuneafrique.com", `
    <article class="article"><header><h1 class="headline__title">${TITLE}</h1>
      <p class="headline__lead text-18 leading-24">${lead}</p></header>
      <div class="article__content font-serif">
        <div class="article-data"><p>Publié le 18 octobre à 15h47 Lecture : 3 minutes.</p>
          <p class="hidden print:block">Fichier généré le <span data-print-date></span></p></div>
        <div data-mrf-recirculation="Corps d'article">${BODY}</div>
      </div>
    </article>`)

  const { textContent } = extractArticle(doc)
  assert.ok(textContent.startsWith(lead))
  assertBody(textContent)
  assert.doesNotMatch(textContent, /Fichier généré|Publié le|Lecture :/)
})

test("Franceinfo termine sur l'article sans les longues listes de recommandations", () => {
  const recommended = "Un autre dossier présente les collections et les expositions de plusieurs musées, avec le programme des rencontres et les horaires prévus pour les visiteurs."
  const cards = Array.from({ length: 6 }, (_, i) => `<li><article class="card-article-list-s">
    <a href="/autre-${i}"><p class="card-article-list-s__title">${recommended}</p></a></article></li>`).join("")
  const shorts = Array.from({ length: 12 }, () => `<div><p class="card-shuffle-v2__title">Une vidéo présente les coulisses d'une exposition et les réactions des visiteurs.</p><span>vidéo 52 secondes</span></div>`).join("")
  const doc = documentAt("franceinfo.fr", `
    <main><article id="js--content"><section class="fi-layout-section">
      <h1>${TITLE}</h1><div class="c-body">${BODY}
        <div class="media-embed"><article class="card-article-list-xs"><p>À lire aussi : une autre collection.</p></article></div>
      </div>
      <div class="preferred-source preferred-source--activated"><p class="preferred-source__text">Vous pouvez désormais privilégier l'affichage des articles de franceinfo dans les résultats de recherche Google. <a href="/explication">Comment ça marche ?</a></p></div>
    </section>
    <section class="generic-vertical-rebound"><div role="heading" aria-level="2">Sur le même thème</div><ul>${cards}</ul></section>
    <section class="carousel shuffle-videos"><p>Shorts</p>${shorts}</section>
    </article></main>`)

  const { textContent } = extractArticle(doc)
  assertBody(textContent)
  assert.ok(textContent.endsWith(PROSE.at(-1)!))
  assert.doesNotMatch(textContent, /autre dossier|autre collection|réactions des visiteurs|vidéo 52 secondes|privilégier l'affichage|Google/)
})
