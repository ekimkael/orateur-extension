# Fiche store — Orateur

Fichier de travail : le contenu à copier-coller dans les trois consoles. Il est
volontairement hors du paquet (mais présent dans l'archive des sources).

Locale secondaire depuis que `default_locale` est passé à l'anglais
(jalon 1a) — voir [store-listing.en.md](store-listing.en.md) pour la fiche
principale.

- **Politique de confidentialité** :
  <https://github.com/ekimkael/orateur-extension/blob/main/PRIVACY.md>
- **Site / support** : <https://github.com/ekimkael/orateur-extension>
- **Catégorie** : Accessibilité (Chrome / Edge), Autre (AMO)
- **Langue principale** : Français

---

## Nom

```
Orateur
```

## Description courte (132 caractères max)

```
Écoutez n'importe quel article ou texte sélectionné, à voix haute sur la page ou envoyé vers Orateur.
```

## Description longue

```
Orateur transforme les articles et le texte sélectionné en lecture audio.

━━ Écouter directement sur la page ━━

Clic droit → « Lire cette page ». Orateur isole l'article du reste de la
page — menus, pubs, encarts — et le lit à voix haute. Une pastille discrète
apparaît en bas de l'écran pour mettre en pause, régler la vitesse ou changer
de voix. Faites un clic droit sur un paragraphe puis choisissez « Lire à partir
d’ici » pour commencer à cet endroit si Orateur le retrouve dans l'article extrait.

━━ Deux voix, à vous de choisir ━━

• La voix de votre système, disponible immédiatement, sans rien télécharger.
  Certaines voix système utilisent le service en ligne de leur fournisseur.
• Supertonic, une voix neuronale nettement plus naturelle, qui tourne
  entièrement sur votre machine, choisie par défaut sur les nouvelles
  installations. Les mises à jour conservent votre moteur. Ses modèles sont
  téléchargés à la première lecture ou sur demande dans les réglages (environ 400 Mo), puis elle
  fonctionne sans réseau. Prévoyez quelques minutes pour ce premier
  téléchargement.

━━ Envoyer vers Orateur ━━

Un clic sur l'icône envoie l'article de la page vers l'application web Orateur,
pour l'écouter, le reprendre plus tard ou le garder en file d'attente.

Sélectionnez du texte n'importe où et une bulle apparaît : « Lire » le dit à
voix haute directement sur la page. Le menu contextuel propose la même chose,
avec en plus « Lire la sélection plus tard », pour l'envoyer vers Orateur.

La lecture complète des PDF est indisponible dans la visionneuse intégrée
au navigateur. Si le navigateur expose une sélection du PDF, le menu contextuel
peut envoyer ce texte à Orateur pour l'écouter plus tard.

━━ Vie privée ━━

Aucun compte nécessaire pour lire sur la page. Supertonic traite le texte
localement après le téléchargement de ses modèles ; la confidentialité des
voix système dépend du fournisseur de la voix choisie. Le texte est envoyé
vers l'application web Orateur uniquement si vous choisissez de l'y sauvegarder.
Des statistiques d'usage sont activées par défaut et peuvent être désactivées
dans Réglages → Confidentialité. Elles utilisent un identifiant aléatoire et
incluent la version de l'extension ainsi que, si disponibles, le nom et la
version majeure du navigateur. Elles n'incluent jamais le texte, le titre ou
l'adresse des pages. Une désactivation déjà enregistrée reste respectée après
une mise à jour.

Détails : https://github.com/ekimkael/orateur-extension/blob/main/PRIVACY.md
```

---

## Justifications de permissions (Chrome Web Store et Edge)

### `<all_urls>` — hôte + content scripts

```
La bulle de sélection et la pastille de lecture doivent déjà être présentes sur
la page au moment où l'utilisateur agit : la bulle apparaît après une
sélection, et la pastille doit pouvoir s'afficher dès le clic sur le menu
contextuel. Un content script injecté après coup arriverait trop tard.

activeTab ne suffit pas. Il n'accorde l'accès qu'après un clic sur l'icône ou
sur une entrée de menu contextuel ; or le clic sur la pastille de lecture n'est
pas un « geste utilisateur » au sens du navigateur, et l'extraction de
l'article déclenchée depuis cette pastille se verrait refuser l'injection.

L'extraction d'article s'exécute lorsque l'utilisateur demande une lecture ou
une sauvegarde. Le téléchargement des modèles et les statistiques configurées
passent par les pages de l'extension ou le background, pas par la page visitée.
Les statistiques excluent le contenu des pages. Une voix système choisie peut
utiliser le service en ligne de son fournisseur.
```

### `scripting`

```
Injecter à la demande l'extracteur d'article (Mozilla Readability) dans
l'onglet actif, uniquement au moment où l'utilisateur demande une lecture ou un
envoi vers Orateur.
```

### `unlimitedStorage`

```
Le moteur de synthèse vocale local (Supertonic) conserve environ 400 Mo de
modèles ONNX dans l'OPFS après lecture ou demande de téléchargement. Sans cette
permission, le quota par origine peut les évincer et forcer un nouveau
téléchargement complet.
```

### `offscreen`

```
La synthèse vocale a besoin d'un DOM et d'un élément <audio>, dont un service
worker MV3 ne dispose pas. Le document offscreen héberge le moteur, partagé par
tous les onglets.
```

### `contextMenus`

```
Ajouter « Sauvegarder dans Orateur », « Lire avec Orateur », « Lire la sélection
plus tard », « Lire cette page » et « Lire à partir d’ici » au menu contextuel,
selon que l'utilisateur clique sur une page, un lien ou une sélection.
```

### `storage`

```
Mémoriser les préférences de lecture (moteur, vitesse, voix), les réglages
d'interface, les sites exclus, la progression, les règles personnelles de
prononciation, ainsi que la préférence et l'identifiant des statistiques.
Coordonner les onglets pour qu'un seul parle à la fois.
```

### `activeTab`

```
Agir sur l'onglet courant après un clic sur l'icône de l'extension ou sur une
entrée du menu contextuel.
```

---

## Déclaration d'usage des données (Chrome Web Store)

- Déclare **Activité utilisateur** (événements d'usage avec identifiant
  aléatoire — activation des statistiques, début et fin de lecture, erreurs,
  résultat du téléchargement Supertonic, échecs d'extraction ; version de
  l'extension, nom et version majeure du navigateur) comme
  collectée, activée par défaut et désactivable dans les réglages. Vérifier l'intitulé exact
  dans le formulaire du Developer Dashboard CWS au moment de la soumission —
  la taxonomie bouge de temps en temps.
- Tout le reste reste **aucune**.
- Cocher les trois attestations : pas de vente à des tiers, pas d'usage hors du
  cas d'usage principal, pas d'usage pour établir la solvabilité ou du prêt —
  toutes trois toujours vraies avec cette télémétrie.

## Firefox / AMO

- `data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] }`
  est déjà déclaré dans le manifest (`wxt.config.ts`).
- **Instructions de build** à coller dans le champ prévu :

  ```
  Node 24, npm 11.

  npm ci
  npm run zip:firefox

  Sans WXT_POSTHOG_KEY et WXT_POSTHOG_REGION, les statistiques sont inactives.
  Pour reproduire un paquet configuré, fournir au build la même clé publique
  de projet PostHog et la région eu ou us, via les variables d'environnement
  ou .env.production.local. Voir .env.example pour les noms des variables.
  Aucune clé personnelle n'est requise.

  Le paquet soumis est .output/orateur-extension-<version>-firefox.zip.

  Note : public/ort/ n'est pas dans l'archive des sources — ces trois fichiers
  du runtime onnxruntime-web sont recopiés depuis node_modules/onnxruntime-web/dist
  au chargement de wxt.config.ts, y compris pendant wxt prepare (l'étape
  postinstall de npm ci), par copyOrtAssets().
  ```

- **Notes au relecteur** :

  ```
  L'extension embarque le runtime WebAssembly d'onnxruntime-web (26 Mo,
  non modifié, provenant du paquet npm onnxruntime-web) pour faire tourner
  localement le moteur de synthèse vocale Supertonic.

  Les modèles ONNX ne sont pas embarqués : ils sont téléchargés depuis le dépôt
  public https://huggingface.co/Supertone/supertonic-3 à la première lecture
  avec ce moteur ou sur demande explicite dans les réglages, et stockés dans
  l'OPFS de l'extension. Ce sont des poids de modèle, pas du code exécutable.

  lib/spike-checks.ts et lib/spike-phrase.ts sont des bancs d'essai de
  développement conservés dans le dépôt. Ils ne sont importés par aucun
  entrypoint et n'apparaissent donc pas dans le paquet construit.

  Télémétrie désactivable (lib/telemetry.ts) : activée par défaut en l'absence
  de préférence enregistrée ; une désactivation antérieure reste respectée.
  L'utilisateur peut la désactiver depuis Réglages → Confidentialité. La configuration
  WXT_POSTHOG_KEY et WXT_POSTHOG_REGION est intégrée au build ; absente ou
  invalide, elle neutralise les envois. Sur Firefox, l'autorisation facultative
  de collecte technicalAndInteraction du navigateur est aussi requise ;
  sans autorisation vérifiable, aucun événement n'est envoyé. Une fois activée,
  autorisée et configurée,
  un simple fetch() POST part vers PostHog
  (eu.i.posthog.com/i/v0/e/ ou us.i.posthog.com/i/v0/e/, selon la région) — pas
  de posthog-js, pas de script tiers, rien de plus qu'un corps JSON avec un
  nom d'événement, un identifiant aléatoire généré localement, et un
  ensemble fermé de propriétés techniques dont la version de l'extension et,
  si disponibles, le nom et la version majeure du navigateur ($browser et
  $browser_version). Aucun User-Agent brut ne figure dans les propriétés
  d'événement (voir PRIVACY.md, « Optional usage analytics »). Le background
  filtre ces propriétés à l'exécution. Jamais le texte, le titre ou l'URL de la
  page. Désactiver le suivi efface l'identifiant local et arrête les nouveaux
  envois ; cela n'efface pas les événements déjà reçus.
  ```

---

## Captures d'écran

Chrome et Edge : au moins une en 1280×800. Edge veut en plus un logo 300×300.

1. La bulle de sélection sur un article.
2. La pastille de lecture en cours, réglages ouverts.
3. Le menu contextuel avec les entrées d'Orateur.
