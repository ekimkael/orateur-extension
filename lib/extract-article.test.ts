import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

/**
 * Readability n'accorde de score qu'aux blocs de plus de 140 caractères : les
 * fixtures doivent contenir de vrais paragraphes, pas des phrases témoins.
 */
function paragraphs(count: number, prefix = "Paragraphe") {
  return Array.from(
    { length: count },
    (_, index) =>
      `<p>${prefix} ${index + 1}. Le texte décrit ici le sujet en détail, avec assez de mots pour que l'extracteur y voie du contenu éditorial et non du bruit de navigation. Il poursuit sur une seconde phrase tout aussi verbeuse afin de dépasser le seuil de densité.</p>`
  ).join("")
}

function docFrom(html: string, url = "https://exemple.fr/articles/mon-article") {
  return new JSDOM(html, { url }).window.document
}

const CLASSIC = `<!doctype html>
<html lang="fr">
  <head>
    <title>La lecture augmentée | Mon Journal</title>
    <meta name="author" content="Camille Durand" />
    <meta name="description" content="Pourquoi écouter change la lecture." />
    <meta property="og:site_name" content="Mon Journal" />
    <meta property="article:published_time" content="2026-03-14T09:00:00.000Z" />
  </head>
  <body>
    <nav><a href="/">Accueil</a><a href="/tech">Tech</a><a href="/abo">S'abonner</a></nav>
    <article>
      <h1>La lecture augmentée</h1>
      ${paragraphs(4)}
      <h2>Une section intermédiaire</h2>
      ${paragraphs(2, "Suite")}
      <ul><li>Premier point de la liste</li><li>Second point de la liste</li></ul>
      <blockquote>Écouter, c'est lire autrement.</blockquote>
      <figure><img src="/photo.jpg" alt="Une photo" /><figcaption>Légende de la photo</figcaption></figure>
    </article>
    <footer>Mentions légales</footer>
    <script>window.analytics = 1</script>
    <style>body { color: red }</style>
  </body>
</html>`

test("extrait et renseigne les propriétés d'un article classique", () => {
  const article = extractArticle(docFrom(CLASSIC))

  assert.match(article.title ?? "", /La lecture augmentée/)
  assert.equal(article.byline, "Camille Durand")
  assert.equal(article.siteName, "Mon Journal")
  assert.match(article.publishedTime ?? "", /^2026-03-14/)
  assert.match(article.excerpt ?? "", /écouter/i)
  assert.equal(article.lang, "fr")
  assert.equal(article.url, "https://exemple.fr/articles/mon-article")
  assert.ok(article.readingTimeMinutes >= 1)
  assert.equal(article.length, article.textContent.length)
})

test("préserve titres, listes et citations dans le texte TTS", () => {
  const { textContent } = extractArticle(docFrom(CLASSIC))

  assert.match(textContent, /Une section intermédiaire/)
  assert.match(textContent, /Premier point de la liste/)
  assert.match(textContent, /Écouter, c'est lire autrement\./)
  // Les blocs restent séparés : sans cela le TTS collerait le titre au
  // paragraphe suivant.
  assert.ok(textContent.includes("\n\n"))
  assert.doesNotMatch(textContent, / {2}|\n{3}/)
  assert.doesNotMatch(textContent, /^\s|\s$/)
})

test("supprime scripts, styles, navigation et attributs de présentation", () => {
  const { content, textContent } = extractArticle(docFrom(CLASSIC))

  assert.doesNotMatch(content, /<script|<style|<nav|<footer/)
  assert.doesNotMatch(content, /class=|style=|id=/)
  assert.doesNotMatch(textContent, /Accueil|S'abonner|Mentions légales/)
})

test("ne modifie jamais le DOM d'origine", () => {
  const doc = docFrom(CLASSIC)
  const before = doc.documentElement.outerHTML

  extractArticle(doc)

  assert.equal(doc.documentElement.outerHTML, before)
})

test("déduit l'URL du document quand elle n'est pas fournie", () => {
  const article = extractArticle(
    docFrom(CLASSIC.replace(/<meta property="og:site_name"[^>]*>/, ""))
  )

  assert.equal(article.url, "https://exemple.fr/articles/mon-article")
  // Repli sur le domaine quand og:site_name est absent.
  assert.equal(article.siteName, "exemple.fr")
})

test("rejette une page trop pauvre en contenu", () => {
  const doc = docFrom(
    `<html lang="fr"><body><h1>Bonjour</h1><p>Bienvenue sur le site.</p></body></html>`
  )

  assert.throws(() => extractArticle(doc), /article lisible/)
})

test("rejette une application web (dashboard)", () => {
  const doc = docFrom(
    `<html><body>
      <nav><a href="/">Vue d'ensemble</a><a href="/stats">Statistiques</a><a href="/settings">Réglages</a></nav>
      <main>
        <div class="widget"><span>Revenus</span><span>12 480 €</span></div>
        <div class="widget"><span>Sessions</span><span>3 214</span></div>
        <table><tr><td>Lundi</td><td>412</td></tr><tr><td>Mardi</td><td>508</td></tr></table>
      </main>
    </body></html>`,
    "https://app.exemple.fr/dashboard"
  )

  assert.throws(() => extractArticle(doc), /article lisible/)
})

test("rejette une page GitHub (arborescence de dépôt)", () => {
  const doc = docFrom(
    `<html><body>
      <header><nav><a href="/">Pull requests</a><a href="/i">Issues</a><a href="/m">Marketplace</a></nav></header>
      <main>
        <div id="repo-content-pjax-container">
          <a href="/orateur/extension/tree/main/lib">lib</a>
          <a href="/orateur/extension/blob/main/package.json">package.json</a>
          <a href="/orateur/extension/blob/main/tsconfig.json">tsconfig.json</a>
          <span>Initial commit</span>
          <span>3 commits</span>
        </div>
      </main>
    </body></html>`,
    "https://github.com/orateur/extension"
  )

  assert.throws(() => extractArticle(doc), /article lisible/)
})

test("nettoie un article criblé de publicités", () => {
  const doc = docFrom(
    `<html lang="fr"><body>
      <div class="cookie-banner">Nous utilisons des cookies. Accepter ?</div>
      <article>
        <h1>Test publicitaire</h1>
        <div class="ad-slot">Publicité : achetez maintenant</div>
        ${paragraphs(3)}
        <aside class="advertisement">Encart publicitaire à ne pas lire</aside>
        <div class="sponsored-content">Contenu sponsorisé par une marque</div>
        ${paragraphs(3, "Bloc")}
        <div class="share-buttons"><a href="#">Partager sur X</a></div>
        <section class="related-articles"><a href="/x">À lire aussi : autre sujet</a></section>
        <div class="newsletter-signup">Inscrivez-vous à notre newsletter</div>
      </article>
    </body></html>`,
    "https://presse.fr/test"
  )

  const { textContent } = extractArticle(doc)

  assert.match(textContent, /Le texte décrit ici le sujet/)
  for (const noise of [
    /cookies/i,
    /Publicité/,
    /Encart publicitaire/,
    /sponsorisé/i,
    /Partager sur X/,
    /À lire aussi/,
    /newsletter/i,
  ]) {
    assert.doesNotMatch(textContent, noise)
  }
})

test("extrait un article Medium sans la carte auteur ni les widgets", () => {
  const doc = docFrom(
    `<html lang="en"><head><meta property="og:site_name" content="Medium" /></head><body>
      <article>
        <div class="pw-author"><img src="/a.jpg" alt="" /><a href="/@jane">Jane Doe</a><span>5 min read</span></div>
        <h1>Building a reader</h1>
        ${paragraphs(5)}
        <div class="js-postShareWidget"><button>Clap</button><a href="#">Share</a></div>
        <div class="js-postListHandle relatedPosts"><a href="/p/1">More from Medium</a></div>
      </article>
    </body></html>`,
    "https://medium.com/@jane/building-a-reader"
  )

  const { textContent, siteName } = extractArticle(doc)

  assert.equal(siteName, "Medium")
  assert.match(textContent, /Le texte décrit ici le sujet/)
  assert.doesNotMatch(textContent, /Clap|Share|More from Medium/)
})

test("extrait un article Wikipédia sans les liens d'édition ni la navigation", () => {
  const doc = docFrom(
    `<html lang="fr"><body>
      <div id="mw-navigation"><a href="/wiki/Accueil">Accueil</a><a href="/wiki/Special">Pages spéciales</a></div>
      <div id="mw-content-text">
        <div class="mw-parser-output">
          ${paragraphs(4)}
          <h2>Histoire<span class="mw-editsection"><a href="?action=edit">modifier</a></span></h2>
          ${paragraphs(3, "Section")}
          <ol class="references"><li>Référence bibliographique numéro un</li></ol>
        </div>
      </div>
    </body></html>`,
    "https://fr.wikipedia.org/wiki/Lecture"
  )

  const { textContent } = extractArticle(doc)

  assert.match(textContent, /Histoire/)
  assert.match(textContent, /Le texte décrit ici le sujet/)
  assert.doesNotMatch(textContent, /Pages spéciales/)
})

test("extrait un fil Reddit sans l'arbre de commentaires", () => {
  const doc = docFrom(
    `<html lang="en"><body>
      <div class="Post">
        <h1>Quel lecteur vocal utilisez-vous ?</h1>
        ${paragraphs(4)}
      </div>
      <div class="commentarea">
        <div class="comment">Premier commentaire, plutôt long pour ressembler à du contenu éditorial et tenter de passer le filtre de densité de texte appliqué par l'extracteur.</div>
        <div class="comment">Deuxième commentaire tout aussi bavard, avec assez de mots pour rivaliser avec le corps du billet lors du scoring.</div>
      </div>
    </body></html>`,
    "https://www.reddit.com/r/tts/comments/abc/quel_lecteur"
  )

  const { textContent } = extractArticle(doc)

  assert.match(textContent, /Le texte décrit ici le sujet/)
  assert.doesNotMatch(textContent, /commentaire/i)
})
