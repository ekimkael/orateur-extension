# Moteur Pocket TTS — design

Date : 2026-11-07. Statut : validé et implémenté sur la branche `codex/pocket-tts` (conversation Codex du 7 au 9 novembre 2026).

## Intention

Ajouter Pocket TTS (Kyutai, WebAssembly) comme troisième moteur. Pocket devient le choix par défaut des nouvelles installations, pour la taille de son modèle. Les utilisateurs existants gardent leur moteur et leur voix. La prononciation reste réservée à Supertonic et aux voix système pour le moment.

## Options comparées

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct, sans pattern | Ajouter une troisième branche `if` partout où le code choisit entre Supertonic et système. | Branches dispersées dans la session, les préécoutes et le sélecteur ; la règle de prononciation se duplique. |
| Strategy + Simple Factory + Adapter (retenu) | Un contrat `Player`, une fonction `createPlayer(...)` avec un `switch`, un adaptateur par hôte local. | Une extraction de la session ; pas de nouvelle dépendance. |
| Registre de plugins | Moteurs ajoutés dynamiquement. | Inutile pour trois moteurs connus à la compilation. |

Recommandation retenue : Strategy + Simple Factory + Adapter. Un `switch`, des fonctions et le contrat `Player` suffisent.

## Patterns retenus

| Pattern | Application concrète | État |
|---|---|---|
| Strategy | Un contrat `Player` ; trois implémentations interchangeables pour système, Supertonic et Pocket. | Contrat déjà présent ; Pocket à ajouter. |
| Simple Factory | `createPlayer(...)` regroupe les trois branches de construction actuellement intégrées à la session. | À extraire, avec un `switch` explicite. |
| Adapter | Chaque lecteur local traduit les commandes communes vers son hôte et les événements de l’hôte vers ceux de `Player`. | Adaptateur Supertonic existant ; Pocket à ajouter. |
| Injection de dépendances | Le serveur de ports reçoit sa fabrique d’hôte ; tester l’aiguillage avec de faux hôtes. | Point d’injection déjà présent dans `createTtsServer`. |

Le rôle du dernier point reste local : pas de conteneur d’injection ni de registre dynamique de plugins.

## Améliorations prioritaires

1. **Séparer choix enregistré et moteur actif.** Conserver `engine`, `voiceURI` et `supertonicVoice`, ajouter `pocketVoice`. Un repli temporaire vers le système ne réécrit pas le choix de l’utilisateur. Pocket devient le défaut uniquement à une vraie installation sans préférence existante ; garder le comportement de migration des anciennes versions.
2. **Rendre la sélection explicite.** Les branches « si Supertonic, sinon système » de la session, du sélecteur de voix et des préécoutes deviennent trois cas. Les événements de télémétrie acceptent le nouvel identifiant moteur avec leur liste de propriétés fermée actuelle.
3. **Centraliser les capacités utilisées plusieurs fois.** Une petite table statique indique notamment `pronunciation: true | false` et le besoin de modèle. Elle sert aux réglages et au chemin d’exécution. Cette table décrit les moteurs ; elle ne charge pas leurs runtimes dans chaque page.
4. **Adapter le protocole local.** Distinguer les requêtes Supertonic et Pocket par `engine`, avec des types de voix et de langue propres à chacun. Valider le message reçu avant de toucher au lecteur actif. Le port reste un transport commun.
5. **Garder un arbitre unique.** Le serveur TTS conserve un seul propriétaire. Un changement de moteur arrête l’ancien hôte avant de démarrer le nouveau ; les réponses tardives sont filtrées par la lecture/génération active. Le jeton global continue de coordonner les moteurs locaux avec les voix système.
6. **Isoler les runtimes et caches.** Le chemin Supertonic demeure spécifique. Pocket obtient son hôte et son cache, chargés à la demande. Éviter de conserver inutilement les deux modèles en mémoire. Ne partager ordonnanceur, buffers et cache de synthèse qu’après vérification de besoins réellement communs.

## Prononciation

| Moteur effectivement utilisé | Préparation Orateur |
|---|---|
| Système | Comportement actuel, règles personnelles selon les réglages. |
| Supertonic | Comportement actuel, dont `skipPhonetic: true` ; ce drapeau ne désactive pas toute la préparation. |
| Pocket | Pas de `expandText()` ni de dépendance à la lecture du stockage des règles. Le texte extrait et sa structure restent disponibles. |

Les règles restent enregistrées lorsqu’on passe à Pocket. Désactiver les commandes de préécoute de prononciation sous Pocket avec une explication. Un repli effectif vers le système reprend la politique système. Masquer une option dans l’interface ne suffit pas : la même politique s’applique dans l’exécution.

## Invariants et validation future

- Une seule lecture audible ; fermeture d’onglet, changement de moteur et arrêt libèrent l’hôte.
- Des callbacks périmés ne peuvent pas modifier la nouvelle lecture.
- Un aller-retour entre moteurs retrouve la voix précédente de chacun.
- Installation neuve, mise à jour et anciens profils incomplets ont des tests distincts.
- Pocket ne transforme pas le texte avec les règles Orateur ; Supertonic et système gardent leur comportement.
- Vérifier paquets et cycle de vie Chrome/Firefox ; écouter réellement les deux moteurs locaux.

## Correspondance avec le dépôt

- `lib/player.ts:48` : contrat commun existant.
- `lib/reading-session.ts:240` : sélection binaire à extraire.
- `lib/reader-prefs.ts:24` : préférences et voix séparées.
- `entrypoints/background.ts:217` : distinction installation / mise à jour.
- `lib/tts-messages.ts:54` : requête actuellement typée pour Supertonic.
- `lib/tts-port.ts:63` : fabrique d’hôte injectée, propriétaire unique.
- `lib/tts-host.ts:235` : chargement spécifique du moteur Supertonic.
- `lib/pronunciation-preview.ts:82` : branche de préécoute actuellement binaire.
- `lib/telemetry.ts:85` : types d’événements limités aux deux moteurs actuels.

## Implémentation

- Contrat et fabrique : `lib/player.ts`, `lib/player-factory.ts`, `lib/local-player.ts` (remplace `lib/supertonic-player.ts`).
- Capacités : `lib/engine-capabilities.ts`.
- Hôtes : `lib/local-tts-host.ts`, `lib/pocket-tts-host.ts`, `lib/tts-host.ts`, arbitre unique dans `lib/tts-port.ts`.
- Pocket : `lib/pocket/` (catalogue, cache vérifié par SHA-256, runtime) et `public/pocket/` (runtime WASM et worker, provenance dans `public/pocket/README.md`).
- Préférences : `pocketVoice` séparée ; Pocket semé à l'installation seulement (`entrypoints/background.ts`).
- Prononciation : règles chargées seulement si le moteur actif les accepte (`lib/reading-session.ts`) ; préécoute bloquée sous Pocket (`lib/pronunciation-preview.ts`), règles conservées et éditables.

Schémas d'origine (hors dépôt) : `~/.codex/visualizations/2026/11/07/01a1b542-0a1e-76c0-aa57-3b7689ad36cb/`.
