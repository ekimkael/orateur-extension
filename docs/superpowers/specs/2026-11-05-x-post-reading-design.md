# Lecture des posts et Articles X — design

Date : 2026-11-05. Statut : validée par l'utilisateur le 2026-11-05.

## Intention

Sur X, « Lire cette page » doit lire **le post que l'utilisateur a ouvert**, et rien d'autre, découpé en paragraphes comme un article. Aujourd'hui l'extracteur ne connaît pas X : Readability score toute la page et lit le mauvais post, un seul bloc, ou l'interface.

Le déclencheur : des posts longs d'actualité (EsbiMedia, ~4 000 caractères) que les lecteurs trouvent « trop longs à lire » — exactement le cas où Orateur doit briller.

## État actuel mesuré

Mesure du 2026-11-05 : `extractArticle` (avec repli `visibleText`, comme `extract.content.ts`) exécuté dans Firefox Developer Edition 2026-11-02, profil vierge, **vue déconnectée** de X.

| Page | Type | Ce qui est lu |
|---|---|---|
| [EsBi_Media/2117662525101617472](https://x.com/EsBi_Media/status/2117662525101617472) | post long | Le bon texte, mais **un seul bloc** : les 8 sauts de paragraphe deviennent des espaces. Intro « EsbiMedia (@EsBi_Media) sur X » (pseudo lu). Hashtag final lu. |
| [EsBi_Media/2118072619425579455](https://x.com/EsBi_Media/status/2118072619425579455) | post long | Idem : un seul bloc. |
| [RucellVie/2117967170156060776](https://x.com/RucellVie/status/2117967170156060776) | post court + citation de citation | **Uniquement l'aperçu tronqué du post cité au 2e niveau** (« …caporal-chef Mfoula. »). Le post ouvert n'est pas lu. |
| [Mikoas237/2117686318545146250](https://x.com/Mikoas237/status/2117686318545146250) | réponse courte | **Le post parent tronqué**, pas la réponse. |
| [Lumineux59/2117703791848120757](https://x.com/Lumineux59/status/2117703791848120757) | réponse courte | Repli texte visible : **l'interface** (« Post. Se connecter S'inscrire. Conversation. EsbiMedia. @EsBi_Media. 3 nov. … 798. Vues. »). |
| [DeRonin_/2095180126359105955](https://x.com/DeRonin_/status/2095180126359105955) | Article X | Corps complet et bien découpé (~75 000 car., `p`/`h3`/`li`). Mais : intro « Ronin sur X : « How to become… » / X » ; **~115 URL lues** (« Link: https://www.falstad.com/circuit/. ») ; **fin coupée** (« Go build something that moves », « Hope this was useful… » : `pruneTrailingResidue` retire les blocs courts non ponctués). |

### Structure DOM observée (vue déconnectée)

- Chaque post est un `<article>` ; la page d'un post contient aussi le parent (si réponse), les citations (imbriquées dans le post) et les réponses.
- Aucun `data-testid`. Classes Tailwind utilitaires (instables) ; quelques classes sémantiques : `x-article-body`, `x-link`, `x-avatar`.
- Texte d'un post : `div[dir=auto]` contenant des `span` en `white-space: pre-wrap`. **Paragraphes = `\n\n` dans le texte**, aucun `<p>` ni `<br>`.
- Permalien d'un post : lien `a[href="/<compte>/status/<id>"]` sur l'horodatage.
- Article X : même URL `/status/<id>` ; `h1` (titre), `div.x-article-body` contenant `p` (`pre-wrap`), `h3`, `ul/li`, `figure`, `strong`. Après le corps : signature et bio de l'auteur, « More Articles », « Join 120.4K followers », date, vues, compteurs.
### Structure DOM observée (vue connectée)

La vue connectée est une **autre application** : l'interface react-native-web historique (classes `css-*` / `r-*`), alors que la vue déconnectée est la refonte Tailwind. Capturée le 2026-11-05 dans le Firefox connecté de l'utilisateur (`<main>` rendu, sans scripts ni SVG) :

- Chaque post : `article[data-testid="tweet"]`, non imbriqués entre eux.
- Texte : `[data-testid="tweetText"]` avec attribut `lang` ; paragraphes = `\n\n` dans le texte, aucun `<br>`.
- **Citations non imbriquées en `article`** : le post cité et son propre post cité vivent *dans* l'`article` du post ouvert, sous `div[role="link"]` (2e niveau : `[data-testid="nestedQuotePreview"]`). Leur `tweetText` est donc un descendant de l'`article` ouvert ; il faut exclure tout `tweetText` situé sous un `div[role="link"]`.
- Permalien : `a[href="/<compte>/status/<id>"]` contenant un `<time>` ; les citations ont un `<time>` sans lien.
- Article X : `[data-testid="twitter-article-title"]` (titre), `[data-testid="twitterArticleRichTextView"]` > `[data-testid="longformRichTextComponent"]` (corps Draft.js) ; **aucun `<p>`** : chaque paragraphe est un `div[data-block="true"]` (783 blocs), titres en `h2`, listes `ul/li`. Après le corps : « Vous voulez publier votre propre Article ? Passer à Plus », date, vues, compteurs.

| Page (vue connectée) | Ce qui est lu aujourd'hui |
|---|---|
| Post long EsbiMedia | Un seul bloc, hashtag final lu. |
| Post + citations (RucellVie) | **L'interface et les réponses** : « Post. Conversation. … Citation. Minkok Peupah 👑🇨🇲. @Minkok_daddy. 3 nov. … Postez votre réponse. Le public a besoin… » |
| Réponses courtes (Mikoas237, Lumineux59) | Repli texte visible : « Post. Conversation. EsbiMedia. @EsBi_Media. 3 nov. » puis le post parent. |
| Article X (Ronin) | Corps complet en 783 blocs, mais titre « Ronin sur X : "…" », fin coupée, URL lues. |

Les captures contiennent des données du compte de l'utilisateur (sa propre réponse, son avatar) : elles restent hors du dépôt, les fixtures sont réduites à la main.

## Objectifs

1. Sur une page `/status/<id>`, lire **uniquement le post `<id>`** : son texte, rien d'autre.
2. Chaque paragraphe du post est un bloc de lecture (navigation précédent/suivant, surlignage, reprise).
3. Sur un Article X : annoncer son titre (`h1`), lire tout le corps (titres, paragraphes, listes), **jusqu'à la dernière phrase**, sans la signature ni l'interface autour.
4. Ne lire **aucune URL** (posts et Articles).
5. Fonctionne dans les vues connectée et déconnectée, Chrome et Firefox.

## Non-objectifs

- Fil d'accueil, profil, recherche, listes, notifications : **pas de lecture**. L'utilisateur doit ouvrir explicitement le post (décision utilisateur : « sinon ça sera compliqué »).
- Posts cités, post parent d'une réponse, réponses, suite du fil (thread) de l'auteur : **non lus** (décision utilisateur : « juste le tweet »).
- Texte alternatif des images, vidéos, sondages, cartes d'aperçu de lien : non lus.
- Traduction X (« Afficher la traduction ») : on lit le texte affiché tel quel, aucun traitement dédié.
- Import côté serveur d'une URL X dans l'app web (`/api/import-article`) : hors lot. Le transfert « écouter plus tard » profite du nouvel extracteur via le `HandoffPayload` existant, sans autre changement.
- Politique générale des URL sur les autres sites : hors lot (voir « Suites possibles »).

## Anti-objectifs (échec même si « ça marche »)

- Lire un autre post que celui de l'URL, même en partie.
- Lire un libellé d'interface (nom, @pseudo, date, « Vues », compteurs, « Afficher la traduction », « Se connecter »).
- Retomber sur le texte visible de toute la page quand le post n'est pas trouvé : sur X, mieux vaut l'erreur « pas d'article lisible » que l'interface lue.
- Dépendre de classes Tailwind utilitaires (`text-lead`, `font-normal`…) : elles changent sans prévenir.

## Contraintes

- Business logic dans `lib/` avec tests `node --test` (jsdom) ; `entrypoints/extract.content.ts` reste du câblage (AGENTS.md).
- Un correctif arrive avec un test de régression qui échoue avant.
- Le document d'origine n'est jamais modifié (même contrat que `extractArticle` / `extractGmailMessage`).
- Copie par `cloneNode`/`importNode`, jamais par chaîne HTML (Trusted Types, comme Gmail).
- Télémétrie : aucun texte, titre ni URL (inchangé).
- Lecture réelle à l'oreille dans Chrome **et** Firefox avant de dire « fini » (la synthèse simulée ne prouve rien).

## Conception

### Options comparées

**A. Pas de pattern, code direct dans `extractArticle`.** Ajouter `x.com` aux règles par hôte de `prepareEditorialContent` : isoler le post dans le clone, transformer les `\n\n` en blocs, puis laisser Readability faire.
- Résout : paragraphes et bruit sur les posts longs.
- Coût : faible. Mais Readability et `isProbablyReaderable` restent sur le chemin : un post court (< 120 caractères) échoue au seuil et retombe sur `visibleText`, qui lit l'interface. Il faudrait contourner ces deux garde-fous pour X, et `pruneTrailingResidue` couperait encore la fin des posts non ponctués.

**B. Extracteur dédié, comme Gmail.** Une fonction exportée `extractXPost(doc, url)` dans `lib/`, choisie par nom d'hôte dans `extract.content.ts` exactement comme `extractGmailMessage`, sans repli `visibleText`.
- Résout : tout. Le post est trouvé par son permalien, pas par un score ; posts courts et longs suivent le même chemin ; Article lu depuis son conteneur connu ; aucune règle de nettoyage générique (résidu de fin) n'interfère.
- Coût : une fonction de plus et ses tests ; réutilise `clean`, `toSpeakableText`, `withStop`, `normalize` déjà présents. Le précédent Gmail rend le code familier.

**C. Registre d'extracteurs par site (pattern Strategy).** Une table `{ match(host), extract }` qui remplace le `if` Gmail de `extract.content.ts`.
- Résout : l'ajout de futurs sites sans toucher au point d'entrée.
- Coût : une abstraction pour deux entrées. Rien ne l'exige aujourd'hui.

**Recommandation : B.** A ne tient pas les posts courts sans contourner Readability, ce qui revient à B en moins lisible. C n'apporte rien tant qu'il n'y a que deux sites ; le passage de B à C coûte dix lignes le jour où un troisième site arrive.

**Décision utilisateur (2026-11-05) : B.**

### Comportement attendu (option B)

**Hôtes couverts :** `x.com`, `twitter.com`, `mobile.x.com`, `mobile.twitter.com`.

**Page non-post** (pas de `/status/<id>` dans le chemin, ou post introuvable, supprimé, protégé) : erreur `NOT_AN_ARTICLE`, **pas** de repli texte visible. Le message affiché est le message existant.

**Trouver le post :** l'`article` dont le permalien propre (hors post cité imbriqué) pointe vers `/<compte>/status/<id>` de l'URL. Le parent d'une réponse et les réponses ont un autre `<id>` ; un post cité est imbriqué dans le post et doit être exclu de son texte.

**Post (court ou long) :**
- Texte = texte affiché du post, sans post cité, carte de lien, média, nom, pseudo, date, compteurs.
- Chaque saut de ligne sépare un bloc ; les lignes vides se fusionnent. *(Choix du rédacteur : une ligne seule dans un post est presque toujours un item ou une phrase isolée.)*
- Ponctuation finale ajoutée par `withStop` ; **aucun** rognage de résidu de fin.
- Hashtags : la série de hashtags en fin de post est retirée ; un hashtag au milieu d'une phrase est lu sans le `#`. *(Supposition validée par silence de l'utilisateur.)*
- Mentions : les mentions de tête d'une réponse ne sont pas lues ; une mention dans la phrase est lue sans le `@`. *(Choix du rédacteur.)*
  *Révisé à l'implémentation : X n'écrit jamais le destinataire d'une réponse dans son texte (vérifié sur les deux vues) ; une mention en tête est donc le sujet du post et reste lue, sans le `@`.*
- URL : aucune n'est lue (`https?://…`, liens `t.co`, et liens affichés tronqués par X du type `youtube.com/@x…`). *(Décision utilisateur.)*
- Emoji décoratifs (🛑, ❤️, ⬇️…) : retirés. *(Supposition validée par silence ; certaines voix système lisent leur nom.)*

**Article X :**
- Détecté par la présence du corps d'Article dans le post de l'URL : `div.x-article-body` (déconnecté), `[data-testid="twitterArticleRichTextView"]` (connecté).
- Titre = `h1` de l'Article (déconnecté), `[data-testid="twitter-article-title"]` (connecté).
- Corps = blocs du conteneur via `toSpeakableText` (mêmes annonces de code, même ponctuation), **sans** `pruneTrailingResidue`. En vue connectée, chaque `div[data-block="true"]` est un bloc (`TEXT_BLOCKS` inclut déjà `div`).
- Exclus : image de couverture, signature/bio de l'auteur, « More Articles », « Vous voulez publier votre propre Article ? », bouton d'abonnement, date, vues, compteurs.
- URL retirées du texte ; un bloc réduit à une étiquette (« Link: », « Follow me: ») après retrait est supprimé. *(Choix du rédacteur.)*

**Langue :** attribut `lang` du texte du post s'il existe, sinon langue du document ; `resolveDocLang`/`detectLang` tranchent comme ailleurs.

**Titre et intro parlée :**
- Article : le titre du `h1` (« Au programme : How to become a Robotics Engineer in 6 months (RESOURCES). »).
- Post : **pas d'intro**, la lecture commence directement par le texte. *(Décision utilisateur, parmi : nom affiché seul, pas d'intro, nom + « sur X », première ligne si titre.)*
- Conséquence : aujourd'hui l'intro est construite depuis `article.title` (`buildReadingIntro`, appelé par `system-player.ts` et `supertonic-player.ts`), et ce même `title` devient le titre de l'élément enregistré dans l'app web (`buildImportUrl`, `background.ts`). Il faut donc **séparer « titre » et « annoncer le titre »** : le résultat d'extraction porte une indication que le titre ne doit pas être lu, et les deux players la respectent. La forme exacte (champ, valeur) est laissée au constructeur ; Gmail et les articles gardent leur comportement.
- Titre d'un post (app web, « écouter plus tard ») : `<nom affiché> : <début du post>`, coupé proprement à ~100 caractères. *(Choix du rédacteur : un nom seul ne distingue pas deux posts du même compte dans la liste.)*

`siteName` = `"X"` ; `readingTimeMinutes` calculé comme ailleurs.

**Repère dans la page (surlignage, « lire d'ici ») :** `lib/read-anchor.ts` retrouve chaque bloc par les 80 premiers caractères d'un élément du DOM vivant. Les paragraphes d'un post vivent tous dans un seul `div[dir=auto]` : seul le premier peut correspondre. *(Choix du rédacteur :)* pour un post, le repère est le post entier, et `read-anchor.ts` n'est pas modifié. Le découpage en paragraphes vaut pour la voix, la navigation précédent/suivant et la reprise, qui reposent sur l'index du bloc et non sur le DOM. Si le texte du premier paragraphe est modifié par le nettoyage (emoji, mention de tête), l'absence de repère est acceptée. Les Articles X ont des `p` réels et gardent un repère par paragraphe.

### Ce qui reste au constructeur

- Emplacement exact du code (dans `lib/extract-article.ts` à côté de Gmail pour réutiliser les helpers privés, ou fichier dédié qui les importe).
- Sélecteurs précis, à établir sur captures HTML réelles des deux vues ; préférer `article`, `dir=auto`, `h1`, `href` de permalien, `x-article-body` aux classes utilitaires.
- Format des fixtures : HTML réel réduit (posts long, court, réponse, citation imbriquée, Article ; vues connectée et déconnectée).

**Captures de la vue connectée :** fournies par l'utilisateur le 2026-11-05 dans `~/Downloads/x-logged-in-<id>.html` (une par URL du tableau « État actuel », `<main>` rendu sans scripts, styles ni SVG). Les captures déconnectées sont prises par le constructeur, de la même façon, via Puppeteer. Les fixtures commités sont réduits à la main ; aucune donnée de compte (nom de l'utilisateur connecté, avatar, notifications) n'y reste.

## Tests et vérification

- Tests `node --test` + jsdom sur fixtures réelles réduites : chaque ligne du tableau « État actuel » devient un test qui échoue avant le changement.
- Cas limites : page non-post (accueil, profil) → erreur sans repli ; post supprimé → erreur ; post contenant uniquement une URL ou un média → erreur (rien à lire).
- `npm run compile`, `npm test`.
- Vérification réelle : les six URL ci-dessus, lues à l'oreille dans Chrome et Firefox, vue connectée, moteurs système et Supertonic.

## Docs à mettre à jour

- Nouveau `docs/x-extraction.md` (audit avant/après, comme `docs/gmail-newsletter-extraction.md`).
- `AGENTS.md`, tableau « Docs to read before changing an area », ligne Article extraction.

## Suites possibles (hors lot)

- Politique des URL sur tous les sites (même retrait que sur X ?).
- Lecture de la suite du fil (thread) de l'auteur.
