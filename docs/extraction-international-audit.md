# Audit anglophone et international — 19 octobre 2026

18 nouveaux sites, en complément du premier audit. Sélection couvrant les
États-Unis, l’Europe, le Moyen-Orient, l’Australie, le Canada, l’Asie et l’Afrique.
Un article réel a été ouvert par site, avec une seconde tentative lorsque
l’accès échouait ou qu’un autre format devait être vérifié.

**Résultat : 9 sites avec un article complet vérifié, 9 non vérifiables dans
cette session à cause d’un contrôle d’accès ou d’une erreur réseau.**
Six sites accessibles nécessitaient des corrections. Deux écrans d’erreur
supplémentaires étaient lus par le repli texte ; ils sont maintenant rejetés.

| Site | Article testé | Résultat |
| --- | --- | --- |
| AP News | [Prix Nobel de médecine](https://apnews.com/article/2efe9ee7eae9d808fd49a6da1f53ceba) | HTTP 403, contrôle de sécurité. Corps non vérifiable ; écran rejeté. |
| CNN | [Croissance chinoise au troisième trimestre](https://edition.cnn.com/2026/10/18/economy/china-q3-gdp-intl-hnk) | Conforme : 22/22 blocs éditoriaux, dont l’intertitre. Dateline conservée. |
| NPR | [Les 40 ans des poupées American Girl](https://www.npr.org/2026/10/18/nx-s1-5711243/american-girl-40-samantha-fiona-davis) | Corrigé : 30/30 paragraphes et 10/10 légendes conservés ; commandes « hide caption », crédits doublés et avertissement final retirés. |
| The New York Times | [DeepSeek et les puces d’IA](https://www.nytimes.com/2025/01/23/technology/deepseek-china-ai-chips.html) | HTTP 403, contrôle de sécurité. Corps non vérifiable. |
| Financial Times | [Présentation de GPT-4](https://www.ft.com/content/8bed5cd7-9d1e-4653-8673-f28bb8176385) | HTTP 403, contrôle de sécurité. Corps non vérifiable. |
| Bloomberg | [Cadeaux pour l’année du Cheval](https://www.bloomberg.com/news/articles/2026-02-13/lunar-new-year-2026-10-luxury-gifts-for-the-year-of-the-horse) | HTTP 403, contrôle anti-robot. Corrigé : le repli ne lit plus les 656 caractères de l’écran de contrôle. Corps non vérifiable. |
| Al Jazeera English | [Réaction de Macron après les violences en France](https://www.aljazeera.com/news/2026/10/18/macron-denounces-frances-nationwide-rioting-looting) | Corrigé : 13/13 blocs conservés ; recommandations et demande d’alertes insérées au milieu retirées. |
| DW English | [Arrestations après les violences en France](https://www.dw.com/en/france-reports-almost-2400-arrests-after-riots-looting-and-arson-during-cost-of-living-protests/a-79692322) | Corrigé : chapeau rétabli, 25/25 blocs conservés ; titres et durées vidéo et promotion Google retirés. |
| ABC News Australia | [Un sursaut radio venu de l’Univers ancien](https://www.abc.net.au/news/science/2026-10-09/oldest-fast-radio-burst-three-billion-years-after-big-bang/107233640) | Corrigé : 36/36 blocs de prose conservés ; variantes d’impression des dates retirées pour éviter leur répétition. |
| CBC News Canada | [Vie quotidienne dans Orion](https://www.cbc.ca/news/science/artemis-mission-orion-sleeping-eating-toilet-9.7061728) | Échec réseau `ERR_HTTP2_PROTOCOL_ERROR` sur accueil et article. Le navigateur affiche sa propre page d’erreur ; contenu du média non obtenu. |
| CNA Singapore | [Protection des travailleurs de plateformes en Chine](https://www.channelnewsasia.com/east-asia/china-gig-workers-draft-rules-protection-6459661) | Corrigé : 58/58 blocs conservés ; interface du lecteur audio et mention de sa voix IA retirées. Rubrique, date et source conservées. |
| South China Morning Post | [Déroutement d’un vol Austrian Airlines](https://www.scmp.com/news/world/middle-east/article/3371337/bomb-threat-forces-austrian-airlines-flight-tel-aviv-divert-bulgaria) | Deux articles bloqués HTTP 403. Contrôle anti-robot rejeté ; corps non vérifiable. |
| The Hindu | [Émissions ultraviolettes de novae dans Andromède](https://www.thehindu.com/sci-tech/science/in-a-first-iia-astronomers-spot-ultraviolet-emissions-from-novae-in-andromeda-galaxy/article68961894.ece) | Conforme : 8/8 paragraphes et légende conservés. |
| News24 | [Pourquoi la connaissance des sciences compte](https://www.news24.com/life/why-its-a-problem-that-south-africans-dont-know-much-about-science-20170706) | Deux articles bloqués HTTP 403 Cloudflare. Écrans rejetés ; corps non vérifiables. |
| Ars Technica | [Conception de protéines par IA](https://arstechnica.com/science/2026/10/researchers-use-ai-to-design-proteins-that-cut-up-other-proteins/) | Deux articles bloqués HTTP 403 Forbidden. Écrans rejetés ; corps non vérifiables. |
| Wired | [Données publiques d’Artemis II](https://www.wired.com/story/nasa-just-made-nearly-1-tb-of-artemis-ii-data-available-to-the-public/) | Corrigé : paragraphes éditoriaux courts portant la classe `paywall` récupérés, dans l’ordre. Tous les paragraphes du corps public sont conservés. |
| Scientific American | [Questions auxquelles la science ne répondra peut-être jamais](https://www.scientificamerican.com/article/the-questions-science-may-never-answer/) | Deux articles bloqués HTTP 403 CloudFront. Corrigé : le repli ne lit plus la page d’erreur de 427 caractères. Corps non vérifiable. |
| Smithsonian Magazine | [Une invention néerlandaise contre la pollution plastique](https://www.smithsonianmag.com/innovation/could-this-dutch-invention-help-tackle-plastic-pollution-in-americas-waterways-180989651/) | Conforme : 37/37 blocs éditoriaux, incluant titres et légendes. Première URL bloquée, seconde accessible. |

## Cas Wired : article public et article limité par abonnement

Le premier article, [sur les transistors](https://www.wired.com/story/transistors-changed-everything-heres-how-they-work/),
livrait un seul paragraphe, suivi d’un mur d’abonnement. Le paragraphe reste lu ;
l’offre commerciale est exclue. Le reste du texte n’était pas dans le corps
chargé et n’a pas été récupéré.

Le second article, sur Artemis II, affichait son corps complet : neuf paragraphes,
dont huit avec la classe CSS `paywall`. Le filtre générique supprimait les trois
paragraphes éditoriaux de moins de 400 caractères ainsi que la mention de
traduction portant cette classe, tout en gardant les plus longs. La correction
retire cette classe des paragraphes du corps dans la
copie uniquement, avant le nettoyage. La sortie passe de 2 356 à 3 444 caractères,
avec tous les paragraphes éditoriaux présents et dans l’ordre.

## Vérification

Chrome a chargé les pages et exécuté leur JavaScript. Les DOM rendus, captures
et textes visibles ont été conservés pour comparer le corps réel et l’extraction
avant/après. Un délai de navigation expiré ne vaut pas échec de contenu : CNN,
NPR, ABC et CNA avaient bien un DOM éditorial complet, comparé bloc par bloc.

Les adaptations restent limitées aux domaines et structures observés. Elles
modifient uniquement une copie du document. Les nouveaux rejets CloudFront et
Bloomberg nécessitent des signatures précises de leurs pages d’erreur ; une
simple mention de ces services dans un article ne suffit pas à le rejeter.

Tests de régression ajoutés :

- `lib/extract-access-errors.test.ts` : CloudFront, article parlant de CloudFront, contrôle Bloomberg.
- `lib/extract-us-business-sites.test.ts` : NPR, légendes et crédits photo.
- `lib/extract-world-sites.test.ts` : Al Jazeera, DW, CNA, ABC.
- `lib/extract-science-regional-sites.test.ts` : Wired, extrait limité et prose publique portant la classe `paywall`.

Validation finale : **316 tests réussis**, typage et build Chrome réussis.
Le content script compilé a été rejoué dans Chrome sur **44 captures** :
21 du premier audit et 23 de cette série, tentatives supplémentaires comprises.
Sur chaque capture, le résultat correspond au module source. Les écrans de
blocage testables ne produisent plus de texte de repli. La page d’erreur interne
de CBC est exclue du rejeu : l’extension ne peut pas s’y injecter.
Résumé généré : `.output/test-results/extraction-audit-international/summary.json`.

Les sites bloqués restent à vérifier avec leur vrai contenu disponible. Les
résultats ne garantissent pas tous les formats, tous les articles ni les pages
réservées aux abonnés de chaque média.
