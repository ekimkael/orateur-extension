import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle, extractGmailMessage, visibleText } from "./extract-article.ts"
import { splitUnits } from "./tts-host.ts"

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

  // Sans le nom du site : le titre est prononcé au début de la lecture.
  assert.equal(article.title, "La lecture augmentée")
  assert.equal(article.byline, "Camille Durand")
  assert.equal(article.siteName, "Mon Journal")
  assert.match(article.publishedTime ?? "", /^2026-03-14/)
  assert.match(article.excerpt ?? "", /écouter/i)
  assert.equal(article.lang, "fr")
  assert.equal(article.url, "https://exemple.fr/articles/mon-article")
  assert.ok(article.readingTimeMinutes >= 1)
  assert.equal(article.length, article.textContent.length)
})

test("ne détache du titre que le dernier segment", () => {
  // Le h1 sert de repli à Readability sous 15 caractères : les titres d'essai
  // restent plus longs, sinon c'est lui qu'on mesurerait.
  const titled = (title: string) =>
    extractArticle(docFrom(CLASSIC.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)))
      .title

  assert.equal(titled("Écouter autrement — Mon Journal"), "Écouter autrement")
  assert.equal(titled("Premier - Deuxième - Mon Journal"), "Premier - Deuxième")
  assert.equal(titled("Un titre sans aucun suffixe"), "Un titre sans aucun suffixe")
})

/** Insère du contenu juste avant la fin de l'article de référence. */
function withinArticle(html: string) {
  return CLASSIC.replace("</article>", `${html}</article>`)
}

test("annonce le code au lieu de le prononcer", () => {
  const { content, textContent } = extractArticle(
    docFrom(withinArticle("<pre><code>const lecture = 1;</code></pre>"))
  )

  // Toujours affiché par l'app web, jamais énoncé.
  assert.match(content, /<pre/)
  assert.doesNotMatch(textContent, /const lecture/)
  assert.match(textContent, /Extrait de code\./)
})

test("annonce le code dans la langue de l'article", () => {
  const { textContent } = extractArticle(
    docFrom(withinArticle("<pre>const x = 1;</pre>").replace('lang="fr"', 'lang="en-US"'))
  )

  assert.match(textContent, /Code snippet\./)
})

test("fusionne les annonces de blocs de code consécutifs", () => {
  const consecutive = extractArticle(
    docFrom(withinArticle("<pre>const a = 1;</pre><pre>=> 1</pre><pre>const b = 2;</pre>"))
  )
  const separated = extractArticle(
    docFrom(withinArticle("<pre>const a = 1;</pre><p>Puis on recommence autrement.</p><pre>const b = 2;</pre>"))
  )

  assert.equal(consecutive.textContent.match(/Extrait de code\./g)?.length, 1)
  assert.equal(separated.textContent.match(/Extrait de code\./g)?.length, 2)
})

test("ne lit pas la mention de durée posée par le CMS", () => {
  const { textContent } = extractArticle(
    docFrom(withinArticle("<p>5 min de lecture</p><p>Temps de lecture : 3 minutes</p>"))
  )

  assert.doesNotMatch(textContent, /min de lecture|Temps de lecture/i)
})

test("rogne les titres et étiquettes orphelins de fin d'article", () => {
  const { textContent } = extractArticle(
    docFrom(withinArticle("<p>Partager</p><h2>À lire aussi</h2>"))
  )

  assert.doesNotMatch(textContent, /À lire aussi|Partager/)
  // Le rognage s'arrête à la première prose : la fin de l'article reste.
  assert.match(textContent, /Légende de la photo/)
})

test("garde un titre que Readability jugerait chrome de page à sa seule classe", () => {
  // Reproduit stackoverflow.blog : ses sous-titres portent `class="header"`,
  // que la regex `unlikelyCandidates` de Readability confond avec un bandeau.
  const { content, textContent } = extractArticle(
    docFrom(withinArticle('<h2 class="header">Pourquoi ça marche</h2><p>Explication détaillée du pourquoi, assez longue pour compter comme un paragraphe éditorial et non comme du bruit de mise en page.</p>'))
  )

  assert.match(content, /Pourquoi ça marche/)
  assert.match(textContent, /Pourquoi ça marche/)
})

test("removeNoise garde la main sur un vrai parasite porté par un titre", () => {
  // Contrepartie assumée : desarmHeadings s'exécute après removeNoise, donc un
  // titre que NOISE_PATTERN reconnaît (ici « related ») reste écarté malgré le
  // désarmement destiné à Readability.
  const { textContent } = extractArticle(
    docFrom(withinArticle('<h2 class="related-title">Articles associés</h2>'))
  )

  assert.doesNotMatch(textContent, /Articles associés/)
})

test("ponctue ce qui ne l'est pas, sans doubler ce qui l'est", () => {
  const { textContent } = extractArticle(
    docFrom(withinArticle("<h2>Et pour finir ?</h2><p>Une vraie conclusion, ponctuée.</p>"))
  )

  // Un titre nu prend le point qui lui donne sa chute…
  assert.match(textContent, /Une section intermédiaire\./)
  assert.match(textContent, /Premier point de la liste\./)
  // …un titre déjà ponctué garde le sien.
  assert.match(textContent, /Et pour finir \?/)
  assert.doesNotMatch(textContent, /\?\.|\.\./)
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

test("la voix IA reçoit chaque sous-titre séparément, même dans une liste ou citation", () => {
  for (const level of [2, 3, 4, 5, 6]) {
    for (const wrapper of ["div", "li", "blockquote"]) {
      const heading = `Une section de niveau ${level}`
      const paragraph = "Cette explication développe le sujet annoncé dans le titre précédent."
      const html = `<${wrapper}><h${level}>${heading}</h${level}><p>${paragraph}</p></${wrapper}>`
      const doc = docFrom(withinArticle(html))
      for (const text of [extractArticle(doc).textContent, visibleText(doc).text]) {
        const units = splitUnits(text, "fr")
        const index = units.findIndex((unit) => unit.text === `${heading}.`)
        assert.ok(index >= 0, `${wrapper}/h${level} : titre isolé`)
        assert.equal(units[index]!.endsParagraph, true)
        assert.equal(units[index + 1]!.text, paragraph)
        assert.equal(units[index + 1]!.paragraph, units[index]!.paragraph + 1)
      }
    }
  }
})

test("visibleText sépare les lignes des mails sans perdre la prose directe des div", () => {
  const paragraph = "Les informations qui suivent précisent le calendrier et les étapes du projet. ".repeat(6).trim()
  for (const title of ["<h2>Calendrier du projet</h2>", "<b>Calendrier du projet</b><br>"]) {
    const doc = docFrom(`<body><div>${title}${paragraph}</div><p>Une conclusion suffisamment détaillée pour terminer ce message.</p></body>`)
    const before = doc.body.innerHTML
    const { text } = visibleText(doc)
    assert.deepEqual(text.split("\n\n"), [
      "Calendrier du projet.", paragraph,
      "Une conclusion suffisamment détaillée pour terminer ce message.",
    ])
    assert.equal(doc.body.innerHTML, before)
  }
})

test("les blocs imbriqués gardent leur texte inline et annoncent le code une seule fois", () => {
  const html = '<blockquote>Avant <strong>le titre</strong><h3>Une étape</h3><p>La première explication.</p><pre>const secret = 1</pre>Après le code.</blockquote>'
  const { textContent } = extractArticle(docFrom(withinArticle(html)))
  assert.match(textContent, /Avant le titre\.\n\nUne étape\.\n\nLa première explication\.\n\nExtrait de code\.\n\nAprès le code\./)
  assert.doesNotMatch(textContent, /const secret/)
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

test("ne lit pas l'écran de blocage Cloudflare, même via le repli texte", () => {
  // Structure observée sur un article Medium : HTTP 403, prose d'aide assez
  // longue pour être confondue avec un article par Readability.
  const doc = docFrom(`<html lang="en"><head><title>Attention Required! | Cloudflare</title></head><body>
    <div id="cf-wrapper"><div id="cf-error-details">
      <h1>Sorry, you have been blocked</h1>
      <h2>Why have I been blocked?</h2>${paragraphs(3, "Security check")}
      <h2>What can I do to resolve this?</h2>${paragraphs(2, "Contact support")}
    </div></div>
  </body></html>`, "https://medium.com/@author/article")
  const before = doc.documentElement.outerHTML

  assert.throws(() => extractArticle(doc), /article lisible/)
  assert.equal(visibleText(doc).text, "")
  assert.equal(doc.documentElement.outerHTML, before)
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

test("visibleText lit un fil de messages sans <p> (à la Gmail)", () => {
  const doc = docFrom(
    `<html lang="fr"><body>
      <div id="conteneur">
        <div class="message">
          <div>Bonjour Marie, je te confirme la réunion de mardi à 14h en salle B. Merci de prévenir Paul si tu ne peux pas venir, on décalera la réunion en fonction des disponibilités de chacun cette semaine-là.</div>
        </div>
        <div class="message">
          <div>Merci pour l'info, je serai présent à cette réunion. Peux-tu aussi inviter Julie, elle travaille sur le même dossier ce trimestre et pourrait apporter des éléments utiles à la discussion de mardi, surtout sur la partie budget qu'elle connaît mieux que nous.</div>
        </div>
      </div>
    </body></html>`
  )

  const { text, lang } = visibleText(doc)

  assert.match(text, /réunion de mardi/)
  assert.match(text, /Julie/)
  // Découpé en blocs (les <div> feuilles du message), pas un seul pavé —
  // sans quoi ni surlignage ni reprise de position ne seraient possibles.
  assert.equal(text.split("\n\n").length, 2)
  assert.equal(lang, "fr")
})

test("visibleText rend une chaîne vide sous le seuil (dashboard, arborescence de dépôt)", () => {
  const dashboard = docFrom(
    `<html><body>
      <nav><a href="/">Vue d'ensemble</a></nav>
      <main><div class="widget"><span>Revenus</span><span>12 480 €</span></div></main>
    </body></html>`
  )
  const repo = docFrom(
    `<html><body>
      <header><nav><a href="/">Issues</a></nav></header>
      <main><div id="repo-content-pjax-container"><a href="/lib">lib</a><span>3 commits</span></div></main>
    </body></html>`
  )

  assert.equal(visibleText(dashboard).text, "")
  assert.equal(visibleText(repo).text, "")
})

test("visibleText ne modifie jamais le DOM d'origine", () => {
  const doc = docFrom(CLASSIC)
  const before = doc.documentElement.outerHTML

  visibleText(doc)

  assert.equal(doc.documentElement.outerHTML, before)
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

// Gmail markup, trimmed: app chrome, the hidden inbox, then the open message.
function gmail(message: string) {
  return docFrom(
    `<!doctype html><html lang="fr"><body>
      <div role="navigation"><a>Boîte de réception</a><a>Messages envoyés</a></div>
      <div>Si vous rencontrez des problèmes de chargement, consultez le Centre d'aide Gmail</div>
      <table><tr class="zA"><td>Autre expéditeur</td><td>Un autre mail de la boîte de réception</td></tr></table>
      <h2 class="hP">Nobody wants your AI app | Dan Maccarone in UX Collective</h2>
      <span class="gD">Medium Weekly Digest</span>
      ${message}
    </body></html>`,
    "https://mail.google.com/mail/u/0/#inbox/abc"
  )
}

const DIGEST = `<div class="a3s aiL"><div class="m_1o">
  <h2><a href="#">Nobody wants your AI app</a></h2><p>The people buying AI are blunt about the fact that the…</p>
  <h2><a href="#">The Darker Side of Growing Old</a></h2><p>The parts of aging we won’t talk about</p>
  <h2><a href="#">Building an AI Agent from Scratch</a></h2><p>I was using Claude, and it felt like magic.</p>
  <div class="iX">[Message tronqué] <a href="#">Afficher l'intégralité du message</a></div>
</div></div>`

test("extractGmailMessage lit toutes les cartes d'un digest, sans l'interface Gmail", () => {
  const article = extractGmailMessage(gmail(DIGEST))

  for (const title of ["Nobody wants your AI app", "The Darker Side of Growing Old", "Building an AI Agent from Scratch"]) {
    assert.match(article.textContent, new RegExp(title))
  }
  // Each card title keeps its own block instead of being glued to its teaser.
  assert.match(article.textContent, /Building an AI Agent from Scratch\.\n\nI was using Claude/)
  assert.doesNotMatch(article.textContent, /Centre d'aide|Boîte de réception|Autre expéditeur|Medium Weekly Digest/)
  assert.equal(article.title, "Nobody wants your AI app | Dan Maccarone in UX Collective")
  // Gmail's UI language, a prior the reader overrides from the text.
  assert.equal(article.lang, "fr")
})

test("extractGmailMessage signale un message tronqué par Gmail sans lire l'avertissement", () => {
  const article = extractGmailMessage(gmail(DIGEST))
  assert.equal(article.truncated, true)
  assert.doesNotMatch(article.textContent, /tronqué|intégralité/)

  const whole = extractGmailMessage(gmail(`<div class="a3s"><p>Un message court mais complet.</p></div>`))
  assert.equal(whole.truncated, false)
})

test("extractGmailMessage refuse la boîte de réception : aucun message ouvert", () => {
  assert.throws(() => extractGmailMessage(gmail("")), /article lisible/)
})

test("extractGmailMessage garde l'article d'une newsletter, sans son enveloppe ni son pré-en-tête", () => {
  const article = extractGmailMessage(
    gmail(`<div class="a3s aiL"><div>
      <div style="display:none;max-height:0px">Aperçu de la boîte de réception ͏ ­͏ ­͏</div>
      <div><a href="#">Forwarded this email? Subscribe here for more</a></div>
      <div><a href="#">Upgrade to paid</a> <a href="#">READ IN APP</a></div>
      <div>${paragraphs(4)}</div>
      <div><a href="#">LIKE</a> <a href="#">RESTACK</a></div>
    </div></div>`)
  )

  assert.match(article.textContent, /^Paragraphe 1\./)
  assert.match(article.textContent, /Paragraphe 4\./)
  assert.doesNotMatch(article.textContent, /Aperçu|Forwarded|Upgrade|READ IN APP|RESTACK/)
  assert.equal(article.title, "Nobody wants your AI app | Dan Maccarone in UX Collective")
  assert.equal(article.lang, "fr")
})

test("extractGmailMessage ignore l'historique cité que Gmail replie dans un fil", () => {
  const reply = (text: string, quoted: string) => `<div class="a3s aiL"><div dir="ltr">${text}</div>
    <div class="HOEnZb adL"><div class="h5"><div class="gmail_quote"><blockquote>${quoted}</blockquote></div></div></div></div>`
  const article = extractGmailMessage(
    gmail(reply("Merci, je regarde ça demain matin.", "Le 14 oct., Alice a écrit : voici le devis.") +
      reply("Parfait, à demain alors.", "Merci, je regarde ça demain matin. Le 14 oct., Alice a écrit : voici le devis."))
  )

  assert.match(article.textContent, /Merci, je regarde ça demain matin\./)
  assert.match(article.textContent, /Parfait, à demain alors\./)
  assert.doesNotMatch(article.textContent, /devis|a écrit/)
  assert.equal(article.textContent.match(/demain matin/g)?.length, 1)
})

test("extractGmailMessage lit l'historique cité que le lecteur a déplié", () => {
  const doc = gmail(`<div class="a3s aiL"><div dir="ltr">Parfait, à demain alors.</div>
    <div class="HOEnZb adL"><blockquote>Le 14 oct., Alice a écrit : voici le devis.</blockquote></div></div>`)
  // jsdom has no layout: a rendered box is what "unfolded" means live.
  const unfolded = doc.querySelector(".adL")!
  unfolded.getClientRects = () => ({ length: 1 }) as DOMRectList

  assert.match(extractGmailMessage(doc).textContent, /voici le devis/)
})

// DEV Digest, trimmed: newsletter tables with inline styles only, so the
// sponsor card is recognised by its label, not by a class name.
const PROMOTED = `<div class="a3s aiL"><table><tr><td>
  <h1>DEV Digest</h1>
  <p>Hey reader, let’s get you caught up!</p>
  <table style="border:2px solid #3b49df"><tr><td>
    <div style="background:#eef0ff"><span>PROMOTED</span></div>
    <h2><a href="#">Meet the speakers at AI DevCon</a></h2>
    <p>Three of the people defining agentic development take the stage in Berlin. Use code DEV20 for 20% off your ticket.</p>
  </td></tr></table>
  <h2><a href="#">I let an open model delete 1,242 of my saved articles</a></h2>
  <p>Accumulated read-later lists create psychological pressure through endless deferred reading obligations.</p>
</td></tr></table></div>`

test("extractGmailMessage skips a newsletter's labelled sponsor card", () => {
  const { textContent } = extractGmailMessage(gmail(PROMOTED))

  assert.doesNotMatch(textContent, /PROMOTED|AI DevCon|DEV20/)
  assert.match(textContent, /Hey reader/)
  assert.match(textContent, /I let an open model delete/)
  assert.match(textContent, /deferred reading obligations/)
})

test("extractGmailMessage drops a sponsor card that opens the message, and only the card", () => {
  // Nothing before the label: climbing must stop at the card, not the message.
  const top = PROMOTED.replace(/<h1>DEV Digest<\/h1>\s*<p>Hey reader, let’s get you caught up!<\/p>/, "")
  const { textContent } = extractGmailMessage(gmail(top))

  assert.doesNotMatch(textContent, /AI DevCon/)
  assert.match(textContent, /deferred reading obligations/)
})
