# Lecture des tableaux — design

Date : 2026-11-06. Statut : validé (choix arrêtés en fin de document).

## Intention

Un tableau lu à voix haute aujourd'hui sonne faux : « Nom. Prix. Stock. Pomme. 2 euros. 12. Poire. 3 euros. 4. » L'auditeur perd le lien entre une valeur et sa colonne dès la deuxième ligne.

Mode retenu (choix « hybride ») : un petit tableau à en-têtes se lit ligne par ligne, chaque valeur rattachée à son en-tête ; un tableau trop grand ou trop complexe est annoncé en une phrase, comme le code.

## État actuel

- `toSpeakableText` (`lib/extract-article.ts`) traite `td` et `th` comme des blocs de `TEXT_BLOCKS` : chaque cellule devient un paragraphe ponctué par `withStop`. En-têtes et valeurs s'enchaînent dans l'ordre du DOM.
- Readability décide « tableau de données / de mise en page » (`_markDataTables`), mais dans une propriété JS (`_readabilityDataTable`) perdue à la sérialisation du `content`. On ne peut pas la relire.
- Les newsletters Gmail (`extractGmailMessage`) sont mises en page en tableaux sans `th` : c'est le cas qu'il ne faut surtout pas casser.
- La sélection (`lib/selection-text.ts`) coupe aussi à chaque cellule ; même défaut, autre chemin.

## Objectifs

- Un tableau de données petit et régulier se lit ligne par ligne, chaque valeur avec son en-tête de colonne.
- Un tableau de données grand ou irrégulier est annoncé en une phrase, sans lecture des cellules.
- Les tableaux de mise en page sont lus exactement comme aujourd'hui.

## Non-objectifs

- La sélection (`selection-text.ts`) : l'utilisateur a choisi ce qu'il sélectionne, lecture brute inchangée. Voir question 4.
- Le surlignage ligne par ligne : la phrase générée n'existe pas dans la page, `read-anchor` ne la retrouve pas et le paragraphe précédent reste surligné (même comportement que le code).
- Les tableaux imbriqués, `rowspan`/`colspan` : annoncés, jamais reconstruits.

## Anti-objectifs (échec même si « ça marche »)

- Une newsletter ou une vieille page en tableaux de mise en page devient « Tableau non lu » : article perdu.
- Une valeur rattachée au mauvais en-tête.

## Conception

### Reconnaître un tableau de données

Critère strict, sous-ensemble du test de Readability : le tableau a un `thead`, ou au moins un `th` dans sa première ligne. Sans en-tête de colonne, pas de rattachement possible : lecture actuelle conservée. C'est ce qui protège les mises en page Gmail.

### Lire ou annoncer

Lu ligne par ligne si toutes ces conditions tiennent, annoncé sinon :

- au plus **8 lignes de données** et **4 colonnes** (question 3) ;
- aucun `rowspan`/`colspan` > 1, aucun tableau imbriqué ;
- chaque ligne de données a le même nombre de cellules que l'en-tête.

Ligne lue : la première cellule sert d'étiquette de ligne, les suivantes sont dites avec leur en-tête. Une cellule vide est sautée. Le `caption`, s'il existe, est dit avant les lignes.

Exemple, en-tête « Fruit | Prix | Stock », ligne « Pomme | 2 € | 12 » : voir question 2 pour la forme.

Les chiffres et symboles des cellules passent ensuite par la préparation du texte existante (`expandText`) comme le reste de l'article.

### Où

`lib/speak-table.ts` : `speakTable(table, lang)` rend la liste des phrases (lignes ou annonce). Dans `collect` de `toSpeakableText`, une branche `TABLE` à côté de celle de `PRE` : tableau de données → phrases poussées comme blocs, sinon parcours actuel. Annonces dans une table par langue, même convention que `CODE_NOTICE` (français par défaut).

### Comparaison des approches

| Approche | Ce qu'elle résout ici | Coût |
|---|---|---|
| **Code direct** : une fonction `speakTable` + une branche dans `collect` | Le besoin, rien de plus. Testable seule sur du DOM jsdom. | ~80 lignes + tests. Une deuxième branche « élément spécial » dans `collect`. |
| **Stratégie** : table `{ PRE: speakCode, TABLE: speakTable }` consultée par `collect` | Prépare d'autres éléments spéciaux (listes de définitions, figures). | Indirection pour deux entrées, aucun troisième cas connu. |
| **Pré-transformation** : réécrire le `<table>` en `<p>` avant `toSpeakableText` | Réutilise tel quel le parcours et la ponctuation. | Mute le DOM extrait, mêle génération de texte et HTML, deux passes à garder cohérentes. |

**Recommandation : code direct.** Deux cas spéciaux ne justifient pas une stratégie ; la pré-transformation cache la logique dans un effet de bord.

## Tests et vérification

- `lib/speak-table.test.ts` : petit tableau lu, `caption`, cellule vide, tableau de 9 lignes annoncé, `colspan` annoncé, ligne irrégulière annoncée, tableau sans `th` → `null` (lecture actuelle).
- `lib/extract-article.test.ts` : article avec tableau de données ; newsletter Gmail en tableaux de mise en page inchangée (régression).
- Écoute réelle Chrome et Firefox, voix système et Supertonic, avec et sans préparation du texte, sur une page Wikipédia à petit tableau et une à grand tableau.

## Docs à mettre à jour

`docs/reading-architecture.md` (ce qui est dit à la place des blocs spéciaux), `docs/extraction-audit.md` si les tableaux y figurent.

## Choix arrêtés

1. **Annonce d'un tableau non lu** : « Vous pouvez consulter le tableau ci-dessous. » Le `caption` n'y figure pas.
2. **Forme d'une ligne lue** : « Pomme : prix, 2 € ; stock, 12. » L'en-tête perd sa majuscule initiale sauf s'il est en capitales (« PIB » reste « PIB »). Hors français, ponctuation sans espace avant : "Apple: price, 2 €; stock, 12."
3. **Seuil** : 8 lignes de données × 4 colonnes.
4. **Sélection** : hors lot.
