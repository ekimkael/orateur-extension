# Suites de la revue de design — design

Date : 2026-11-09. Statut : options validées le 2026-11-09 (A code direct, C table de commandes, D table par site, E `pocket_download_*` ; B suit la recommandation). Branche de départ : `feature/pocket-tts` (après `556faa6`).

## Intention

La revue de design du 9 novembre a trouvé un noyau sain (contrat `Player`, session, port à propriétaire unique, hôte Pocket à `AbortController`) et cinq points autour. Les corrections locales sont faites :

- pastille bloquée en chargement : `556faa6` (rejet `TTS_SPEAK` signalé, voix Supertonic normalisée) ;
- taille du cache Pocket comptée en 10⁶ au lieu de 1024² : `lib/storage-size.ts`, partagé par les options et la barre de téléchargement ;
- bancs d'essai `lib/spike-checks.ts` et `lib/spike-phrase.ts` supprimés (aucun import ; récupérables via `git show 6d995d6`).

Restent quatre refactorings et une décision de télémétrie, chacun à trancher séparément. Aucun ne change le comportement visible.

## A. Logique propre à chaque moteur

Constat : environ 50 tests du nom de moteur (`engine === "pocket"`…) dans 13 fichiers, dont `player-factory.ts` (9), `tts-port.ts` (7), `local-player.ts` (6), `reader.content.ts` (12), `options/App.tsx` (4). Les listes de voix sont écrites deux fois (pastille et `VoicePicker.tsx`). `ENGINE_CAPABILITIES` ne porte que deux booléens.

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct, sans pattern | Garder les branches ; extraire seulement `voiceOptions(engine)` dans `lib/` pour la pastille et les options. | Petit. Les branches restent, chaque nouveau moteur repasse dans 13 fichiers. |
| Table de descripteurs (Strategy par données) | Un fichier par moteur dans `lib/engines/`, en deux moitiés : côté page (voix, libellés, validateur, langues, clés i18n, capacités), sans import du runtime ; côté hôte (`validateSpeak`, `createHost`, cache). `createTtsServer` reçoit un `Record<LocalTtsEngine, HostFactory>`. | Moyen : touche 13 fichiers et leurs tests. Statique, connu à la compilation : ce n'est pas le registre de plugins écarté par la spec Pocket. |
| Strategy par objets (classes `Engine`) | Polymorphisme par méthodes. | Plus de code que la table pour le même résultat ; mélange données et comportement que les deux contextes (page, hôte) doivent séparer. |

Recommandation : code direct maintenant (`voiceOptions`), table de descripteurs le jour où un quatrième moteur ou une fonction commune à tous les moteurs (téléchargement explicite de Pocket, par exemple) est décidé.

## B. `entrypoints/reader.content.ts` (1352 lignes)

Constat : pastille, environ 370 lignes de CSS, surlignage (`createFollower`), panneau de réglages, animations, dans un fichier que `AGENTS.md` décrit comme du câblage.

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct, sans pattern | Passer l'entrypoint en dossier : `reader.content/index.ts` (câblage), `pill.ts`, `follower.ts`, `settings.ts`, `pill.css` importé en chaîne. | Petit à moyen, déplacement pur. Vérifier dans la doc WXT 0.21.4 la forme dossier des content scripts et l'import CSS en chaîne (Vite `?inline`) avec le Shadow DOM fermé. |
| Passive View (déjà en place) | Découper le long des interfaces existantes `ReaderView` et `ReadingFollower` : chaque fichier implémente une interface que la session pilote. | Même coût que le code direct ; le découpage suit des contrats déjà testés. |
| Réécriture en React dans le Shadow DOM | Partager les composants avec les options. | Élevé : React chargé sur chaque page, risque sur le Shadow DOM fermé et les tests e2e. |

Recommandation : le découpage en dossier, aligné sur `ReaderView` et `ReadingFollower`. Pas de réécriture.

## C. `entrypoints/background.ts` : 12 écouteurs `onMessage`

Constat : chaque écouteur filtre sur `type`, `return true` et `sendResponse` sont mêlés, et `MODEL_STATE_QUERY` a deux répondeurs possibles (background et offscreen).

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct, sans pattern | Un seul écouteur avec un `switch (message.type)`. | Petit. Le protocole est lisible en un endroit, la règle `sendResponse` reste à répéter par cas. |
| Table de commandes (Command / dispatch table) | `Record<type, handler>` sur une union typée des messages ; le routeur seul gère `return true` + `sendResponse` pour les handlers asynchrones. | Petit. La règle asynchrone vit une fois ; un type sans handler est une erreur de compilation. |
| Bibliothèque de messagerie (`@webext-core/messaging`, `webext-bridge`) | Protocole typé clé en main. | Nouvelle dépendance pour ce que quelques lignes font ; à éviter. |

Recommandation : table de commandes. Lire avant d'écrire la doc `runtime.onMessage` de Chrome et Firefox pour le retour de promesse (le commentaire actuel dit que Chrome l'ignore sans polyfill).

## D. Extraction : `prepareEditorialContent`

Constat : une chaîne d'environ 20 `else if (host === …)` dans `lib/extract-article.ts` (956 lignes), qui mélange aussi l'extraction générique, Gmail et X.

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct, sans pattern | Découper le fichier : `lib/extract/x.ts`, `lib/extract/gmail.ts`, le reste en place. | Petit. La chaîne de sites reste. |
| Table de nettoyages par site | `const SITE_CLEANUPS: Record<host, (doc) => void>` dans `lib/extract/sites.ts`, plus le découpage ci-dessus. Un audit de site ajoute une entrée. | Petit à moyen. Les fixtures et `extract-article.test.ts` couvrent le déplacement. |
| Chaîne de responsabilité (extracteurs `matches(url)` + `extract(doc)`) | Remplacer aussi l'aiguillage Gmail / X / générique de `extract.content.ts`. | Plus de structure que trois extracteurs n'en demandent. |

Recommandation : table de nettoyages par site, avec le découpage X / Gmail.

## E. Télémétrie du téléchargement Pocket

Constat : Pocket est le moteur par défaut, mais seul Supertonic a un entonnoir (`supertonic_offered`, `supertonic_download_started|completed|failed`, voir `docs/analytics.md`).

| Option | Effet | Coût |
|---|---|---|
| Ne rien ajouter | Aucune mesure du téléchargement du moteur principal. | Nul. |
| Événements parallèles `pocket_download_*` | Entonnoir Pocket sans toucher l'historique Supertonic. | Petit : `local-player.ts`, `telemetry.ts`, `docs/analytics.md`, `PRIVACY.md`. |
| Événements génériques `model_download_*` avec `engine` | Un seul entonnoir pour tous les moteurs. | Casse la continuité des tableaux PostHog existants pour Supertonic. |

Recommandation : événements parallèles `pocket_download_*`, mêmes propriétés que Supertonic, aucune donnée de page.

## Hors périmètre

- Téléchargement explicite de Pocket depuis les options : nouvelle fonction avec du texte visible, à spécifier à part.
- Traduction des commentaires français (55 fichiers) : déjà en cours sur la branche (`61e2c8a`), à poursuivre avec `/docs-sync`.
- Unifier compteurs de génération et `AbortController` dans `tts-host.ts` : gain faible, ce fichier a régressé deux fois.

## Ordre et indépendance

B, C et D touchent des fichiers distincts et peuvent avancer en parallèle. A touche `reader.content.ts` et `background.ts` : après B et C, ou réduit à `voiceOptions`. E est indépendant.

## Validation

- `npm run compile`, `npm test`, `npm run test:packages`, `npm run test:e2e` et `npm run test:e2e:firefox` à chaque étape.
- B : vérifier la pastille dans Chrome et Firefox (ouverture, réglages, surlignage, thème) ; le Shadow DOM reste fermé.
- C : chaque type de message garde sa réponse ; tester le cas offscreen absent pour `MODEL_STATE_QUERY`.
- D : aucune fixture d'extraction ne change de sortie.
- E : les nouveaux événements ne portent ni texte, ni titre, ni URL, ni erreur libre.
