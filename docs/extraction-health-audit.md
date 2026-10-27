# Audit santé et bien-être — 19 octobre 2026

12 sites anglophones visités : **9 articles accessibles vérifiés après
corrections, 3 sites bloqués**. Vérification technique de l’extraction destinée
à la lecture vocale, en incluant les encadrés de soins, précautions, tableaux,
questions fréquentes et références documentaires.

| Site | Page testée | Résultat après correction |
| --- | --- | --- |
| NHS | [High blood pressure](https://www.nhs.uk/conditions/high-blood-pressure/) | 92/92 blocs ; introduction, trois encadrés de soins et liens sur les médicaments préservés. Liens relatifs rendus absolus pour l’import. |
| Mayo Clinic | [Fiche sur l’hypertension](https://www.mayoclinic.org/diseases-conditions/high-blood-pressure/symptoms-causes/syc-20373410) | Deux articles bloqués HTTP 403 ; aucun corps obtenu, repli vide. |
| Cleveland Clinic | [Hypertension](https://my.clevelandclinic.org/health/diseases/4314-hypertension-high-blood-pressure) | 107/107 blocs avec sources fermées ; 114/114 avec sources ouvertes normalement, dont 7 références. Le début, le diagnostic, les autres sections et la note finale ne sont plus tronqués. |
| MedlinePlus | [High Blood Pressure](https://medlineplus.gov/highbloodpressure.html) | 133/133 blocs, dont 71 ressources documentaires ; résumé, tableau, thèmes et groupes de liens préservés sans le sommaire de navigation. |
| Harvard Health | [8 secrets to a good night’s sleep](https://www.health.harvard.edu/newsletter_article/8-secrets-to-a-good-nights-sleep) | 32/32 blocs ; encadré clinique et mise en garde médicale finale préservés. |
| Johns Hopkins Medicine | [Insomnia](https://www.hopkinsmedicine.org/health/conditions-and-diseases/insomnia) | Deux articles bloqués HTTP 403 Cloudflare ; écran rejeté, repli vide. |
| Healthline | [Unintentional Weight Gain](https://www.healthline.com/nutrition/unintentional-weight-gain) | 116/116 blocs ; titres, listes riches en liens, passages sur les médicaments et recommandation de consulter présents. Badges d’interface retirés. |
| WebMD | [Mise à jour d’une fiche de médicament](https://www.webmd.com/drugs/updates/fda-approves-rhapsido-hives-skin-rubbing) | 15/15 blocs ; précautions et 2 références conservées. Promotion Google retirée. |
| Medical News Today | [Compte rendu d’une étude sur l’alimentation](https://www.medicalnewstoday.com/articles/high-fiber-diet-vs-metformin-blood-sugar-control-weight-loss) | 41/41 blocs ; quatre intertitres et introduction récupérés. Citations, attributions et réserves cliniques préservées ; contrôle Pinterest retiré. |
| Verywell Health | [Morning Sunlight Exposure](https://www.verywellhealth.com/morning-sunlight-exposure-3973908) | Accueil et article bloqués HTTP 402 ; aucun corps disponible, repli vide. |
| Psychology Today | [Insomnia](https://www.psychologytoday.com/us/basics/insomnia) | 68/68 blocs, dont 23 questions fréquentes ; introduction et sections conservées sans les cartes d’autres articles. |
| Sleep Foundation | [Insomnia](https://www.sleepfoundation.org/insomnia) | 80/80 blocs et 12/12 références ; cookies, sommaire, formulaires, cartes, invitation communautaire et offre commerciale de test à domicile retirés. Encadrés cliniques conservés. |

## Corrections de fidélité

Readability sélectionnait parfois une seule section d’une fiche documentaire,
ou supprimait des intertitres et listes riches en liens. Pour ces pages, les
conteneurs éditoriaux explicites sont désormais conservés intégralement dans
la copie ; Readability fournit toujours les métadonnées. Le nettoyage retire
les scripts, contrôles et modules commerciaux identifiés.

Les précautions et sources sont traitées comme du contenu. La mise en garde de
Harvard est replacée après le corps. Les références WebMD sont annexées au
corps ; celles de Sleep Foundation sont conservées. Cleveland a été vérifié
dans les deux états du panneau « View Sources », ouvert par l’action normale
du navigateur, sans dupliquer la version destinée à l’impression.

La citation de Medical News Today contenant une réserve sur le remplacement
d’un traitement était déjà présente avant correction. Une première comparaison
brute entre citation et attribution concaténées produisait un faux manque ;
les blocs ont ensuite été comparés séparément. Aucun défaut n’est attribué à
ce passage. Les vrais manques étaient des intertitres et un paragraphe lié.

Les liens documentaires relatifs sont normalisés vers leur URL d’origine.
Les liens web et coordonnées de contact restent disponibles après import ;
les protocoles actifs non autorisés sont retirés en conservant leur texte.
Les opérations portent uniquement sur une copie du DOM.

## Vérification

Captures Chrome des pages rendues, comparaison des paragraphes, listes,
titres, tableaux, avertissements et bibliographies, puis rejeu du content script
compilé. Tests synthétiques fondés sur les structures constatées :

- `lib/extract-clinical-sites.test.ts` : NHS, Cleveland Clinic, MedlinePlus.
- `lib/extract-health-media-sites.test.ts` : Healthline, Medical News Today, WebMD.
- `lib/extract-wellbeing-sites.test.ts` : Harvard, Psychology Today, Sleep Foundation.
- `lib/extract-complete-body.test.ts` : liens après import et DOM d’origine intact.

Validation finale : **339 tests réussis**, typage et build Chrome réussis.
Le script compilé est contrôlé sur **81 captures** des quatre séries : 79
correspondent au module source hors navigateur ; les deux captures de Tom’s
Hardware vérifient séparément les paragraphes dont la conservation dépend de
la mise en page réelle. Les 44 sorties des deux premières séries sont
inchangées. Aucun écran bloqué de cette série ne produit de texte de repli.
Résumé généré : `.output/test-results/extraction-audit-health/summary.json`.

La vérification porte sur les pages indiquées. Les trois sites bloqués restent
à vérifier avec leur vrai contenu accessible ; aucun résultat global sur tous
les articles d’un média n’est déduit d’un seul exemple.
