# Audit de l’extraction d’articles — 19 octobre 2026

18 sites visités, avec une URL d’article ou de publication réelle par site.
13 articles accessibles ont été comparés au texte destiné à la lecture vocale :
chapeau, paragraphes intermédiaires, intertitres, listes, citations et conclusion.
5 sites ont présenté un contrôle d’accès ; leur contenu éditorial reste à vérifier.

## Résultats

| Site | Article testé | Résultat |
| --- | --- | --- |
| Le Monde | [Gratuité de l’enseignement supérieur](https://www.lemonde.fr/idees/article/2026/03/29/dans-l-enseignement-superieur-l-exigence-constitutionnelle-de-gratuite-n-est-pas-une-notion-avec-laquelle-il-est-possible-de-transiger_6675222_3232.html) | Bloqué : « Client Challenge ». Aucun article disponible dans le DOM. |
| Franceinfo | [Allocution après les violences du 17 octobre](https://www.franceinfo.fr/societe/mobilisation-du-17-octobre/rien-ne-le-justifie-rien-ne-l-explique-rien-ne-l-excuse-ce-qu-il-faut-retenir-de-l-allocution-d-emmanuel-macron-apres-les-violences-du-17-octobre_8243143.html) | Corrigé : recommandations, cartes vidéo, liens « À lire aussi » et invitation Google retirés. Tous les blocs éditoriaux conservés. |
| Le Figaro | [Ce qu’il faut retenir de l’allocution](https://www.lefigaro.fr/politique/violences-en-france-colere-et-honte-transparence-attendue-2027-ce-qu-il-faut-retenir-de-l-allocution-d-emmanuel-macron-20261018) | Conforme sur l’article testé ; aucune modification nécessaire. |
| RFI | [Doublé de Félix Lebrun](https://www.rfi.fr/fr/sports/20261018-championnats-d-europe-de-tennis-de-table-f%C3%A9lix-lebrun-fait-le-doubl%C3%A9-au-bout-d-une-belle-semaine-fran%C3%A7aise) | Conforme ; date de publication conservée. |
| France 24 | [Le diamant rose au château de Chantilly](https://www.france24.com/fr/culture/20261018-un-si%C3%A8cle-apr%C3%A8s-son-vol-le-diamant-rose-d%C3%A9voile-toute-ses-facettes-au-ch%C3%A2teau-de-chantilly) | Corrigé : chapeau récupéré, liens « À lire aussi » et titre du lecteur vidéo retirés. |
| Jeune Afrique | [Macky Sall retire sa candidature à l’ONU](https://www.jeuneafrique.com/1853359/politique/secretariat-general-de-lonu-macky-sall-jette-leponge/) | Corrigé : chapeau récupéré ; métadonnées d’impression cachées et encart recommandé retirés. |
| BBC News | [What is climate change?](https://www.bbc.com/news/articles/c9w15nggj58o) | Corrigé : 25 blocs éditoriaux perdus par le filtrage des liens sont récupérés ; invitation newsletter retirée. |
| Reuters | [Retour de Starliner](https://www.reuters.com/technology/space/without-astronauts-boeings-starliner-returns-earth-2024-09-07/) | Bloqué : HTTP 403 « Access Denied ». Aucun article disponible. |
| The Guardian | [Mission japonaise vers Phobos](https://www.theguardian.com/science/2026/oct/18/japan-mission-mars-moon-phobos-samples) | Conforme ; paragraphes et conclusion conservés. |
| Wikipédia | [Lecture](https://fr.wikipedia.org/wiki/Lecture) | Corrigé : intertitres préservés ; appels de notes, références, commandes d’édition et portails retirés. Bibliographie et liens externes conservés. |
| The Conversation | [Aux origines du terme « casseurs »](https://theconversation.com/aux-origines-du-terme-casseurs-88612) | Conforme ; tous les blocs éditoriaux vérifiés sont conservés. |
| Numerama | [Un cratère géant sur la Lune](https://www.numerama.com/sciences/2334439-un-cratere-geant-de-222-metres-vient-dapparaitre-sur-la-lune-et-la-nasa-la-decouvert-par-hasard.html) | Corrigé : explications de consentement vidéo et recommandations retirées ; conclusion conservée. |
| The Verge | [Une arrestation après le blocage d’un robot livreur](https://www.theverge.com/ai-artificial-intelligence/1013541/a-woman-was-arrested-in-philly-for-blocking-a-delivery-robot) | Corrigé : biographie de l’auteur et invitation à suivre retirées ; 3 paragraphes éditoriaux conservés. |
| TechCrunch | [Alternatives à Pocket](https://techcrunch.com/2026/08/14/read-it-later-app-pocket-is-shutting-down-here-are-the-best-alternatives/) | Corrigé : mention commerciale extérieure au corps retirée ; contenu éditorial conservé. |
| Medium | [Don’t Read Articles. Study Them.](https://medium.com/action-in-public/dont-read-articles-study-them-21d71ff3f04b) | Bloqué : HTTP 403 Cloudflare sur deux articles. Corrigé : l’écran de blocage n’est plus accepté comme article ni lu par le repli texte. |
| Substack | [The Shape of the Thing](https://www.oneusefulthing.org/p/the-shape-of-the-thing) | Conforme ; paragraphes et sous-titres conservés, sortie inchangée. Publication publique sur domaine personnalisé Substack. |
| Reddit | [Discussion sur 1984](https://www.reddit.com/r/books/comments/8jb3rr/i_just_finished_1984_by_george_orwell_the_ending/) | Bloqué : « Prove your humanity » ; autre tentative sur old.reddit.com également bloquée. |
| Quora | [Question sur la résolution de x! = 40320](https://fr.quora.com/Comment-puis-je-r%C3%A9soudre-x-40320-math%C3%A9matiquement) | Bloqué : contrôle Cloudflare sur les versions française et anglaise. Corrigé : le repli texte ne lit plus les instructions de vérification. |

## Méthode et portée

Chrome a chargé les pages et exécuté leur JavaScript. Les DOM obtenus, le texte
visible et les sorties de l’extracteur ont été capturés pour comparer les blocs
du corps éditorial. Les mêmes captures sont ensuite rejouées dans Chrome avec
le content script compilé de l’extension. Les requêtes externes sont bloquées
pendant ce rejeu pour conserver exactement le DOM audité.

Les adaptations restent limitées aux domaines et structures constatés. Elles
modifient uniquement la copie du document ; la page consultée reste intacte.
Les contrôles Cloudflare sont exclus aussi du repli `visibleText`, qui pourrait
sinon lire leurs longues instructions après le rejet de Readability.

Tests de régression : `lib/extract-article.test.ts`,
`lib/extract-news-sites.test.ts`, `lib/extract-international-sites.test.ts`,
`lib/extract-platform-sites.test.ts`. Ils reproduisent les structures observées
avec une prose synthétique, sans incorporer les articles complets au dépôt.

Validation : suite complète de 306 tests réussie, puis test supplémentaire du
repli Quora réussi ; typage (`npm run compile`) et build Chrome
(`npm run build`) réussis. Le script compilé produit le même texte que le
module source sur les 21 captures, y compris les tentatives supplémentaires
sur les sites bloqués. Résumé généré :
`.output/test-results/extraction-audit/summary.json`.

Cette vérification concerne un article par site accessible. Elle ne garantit pas
tous les formats du même média (directs, galeries, articles réservés aux abonnés).
Les cinq sites bloqués nécessitent une nouvelle vérification lorsque leur vrai
contenu est accessible. Aucun contrôle d’accès n’a été contourné.
