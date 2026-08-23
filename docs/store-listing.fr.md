# Fiche store — Orateur v0.1.1

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
Orateur transforme n'importe quelle page en lecture audio.

━━ Écouter directement sur la page ━━

Clic droit → « Lire cette page ». Orateur isole l'article du reste de la
page — menus, pubs, encarts — et le lit à voix haute. Une pastille discrète
apparaît en bas de l'écran pour mettre en pause, régler la vitesse ou changer
de voix. Rien ne quitte votre navigateur.

━━ Deux voix, à vous de choisir ━━

• La voix de votre système, disponible immédiatement, sans rien télécharger.
  C'est le réglage par défaut.
• Supertonic, une voix neuronale nettement plus naturelle, qui tourne
  entièrement sur votre machine. Si vous l'activez, l'extension télécharge une
  fois ses modèles (environ 400 Mo) puis fonctionne sans réseau. Prévoyez
  quelques minutes pour ce premier téléchargement.

━━ Envoyer vers Orateur ━━

Un clic sur l'icône envoie l'article de la page vers l'application web Orateur,
pour l'écouter, le reprendre plus tard ou le garder en file d'attente.

Sélectionnez du texte n'importe où et une bulle apparaît : un clic, et la
sélection part vers Orateur. La même chose est disponible dans le menu
contextuel avec « Lire avec Orateur ».

━━ Vie privée ━━

Aucun compte. Rien n'est collecté par défaut. Le texte que vous écoutez sur la
page ne quitte jamais votre machine. Rien n'est envoyé vers Orateur sans que
vous cliquiez pour le demander. Des statistiques d'usage anonymes, totalement
optionnelles et désactivées par défaut, peuvent être activées — ou
redésactivées — depuis les réglages de l'extension.

Détails : https://github.com/ekimkael/orateur-extension/blob/main/PRIVACY.md
```

---

## Justifications de permissions (Chrome Web Store et Edge)

### `<all_urls>` — hôte + content scripts

```
La bulle de sélection et la pastille de lecture doivent déjà être présentes sur
la page au moment où l'utilisateur agit : la bulle apparaît au survol d'une
sélection, et la pastille doit pouvoir s'afficher dès le clic sur le menu
contextuel. Un content script injecté après coup arriverait trop tard.

activeTab ne suffit pas. Il n'accorde l'accès qu'après un clic sur l'icône ou
sur une entrée de menu contextuel ; or le clic sur la pastille de lecture n'est
pas un « geste utilisateur » au sens du navigateur, et l'extraction de
l'article déclenchée depuis cette pastille se verrait refuser l'injection.

L'extension ne lit le contenu d'aucune page tant que l'utilisateur ne le
demande pas, et n'émet aucune requête réseau depuis les pages visitées.
```

### `scripting`

```
Injecter à la demande l'extracteur d'article (Mozilla Readability) dans
l'onglet actif, uniquement au moment où l'utilisateur demande une lecture ou un
envoi vers Orateur.
```

### `unlimitedStorage`

```
Le moteur de synthèse vocale local (Supertonic), si l'utilisateur l'active,
conserve environ 400 Mo de modèles ONNX dans l'OPFS de l'extension. Sans cette
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
Ajouter les entrées « Lire avec Orateur », « Lire la sélection » et « Lire
cette page » au menu contextuel.
```

### `storage`

```
Mémoriser les préférences de lecture (moteur, vitesse, voix) et coordonner les
onglets, pour qu'un seul parle à la fois.
```

### `activeTab`

```
Agir sur l'onglet courant après un clic sur l'icône de l'extension ou sur une
entrée du menu contextuel.
```

---

## Déclaration d'usage des données (Chrome Web Store)

- Déclare **Activité utilisateur** (événements d'usage anonymes — début de
  lecture, résultat du téléchargement Supertonic, échecs d'extraction) comme
  collectée, en opt-in et désactivée par défaut. Vérifier l'intitulé exact
  dans le formulaire du Developer Dashboard CWS au moment de la soumission —
  la taxonomie bouge de temps en temps.
- Tout le reste reste **aucune**.
- Cocher les trois attestations : pas de vente à des tiers, pas d'usage hors du
  cas d'usage principal, pas d'usage pour établir la solvabilité ou du prêt —
  toutes trois toujours vraies avec la télémétrie opt-in.

## Firefox / AMO

- `data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] }`
  est déjà déclaré dans le manifest (`wxt.config.ts`).
- **Instructions de build** à coller dans le champ prévu :

  ```
  Node 24, npm 11.

  npm install
  npm run zip:firefox

  Le paquet soumis est .output/orateur-extension-<version>-firefox.zip.

  Note : public/ort/ n'est pas dans l'archive des sources — ces trois fichiers
  du runtime onnxruntime-web sont recopiés depuis node_modules/onnxruntime-web/dist
  au début du build par le plugin Vite copyOrtAssets() (voir wxt.config.ts).
  ```

- **Notes au relecteur** :

  ```
  L'extension embarque le runtime WebAssembly d'onnxruntime-web (26 Mo,
  non modifié, provenant du paquet npm onnxruntime-web) pour faire tourner
  localement le moteur de synthèse vocale Supertonic.

  Les modèles ONNX ne sont pas embarqués : ils sont téléchargés depuis le dépôt
  public https://huggingface.co/Supertone/supertonic-3 uniquement si
  l'utilisateur active ce moteur (le moteur par défaut est celui du système), et
  stockés dans l'OPFS de l'extension. Ce sont des poids de modèle, pas du code
  exécutable.

  lib/spike-checks.ts et lib/spike-phrase.ts sont des bancs d'essai de
  développement conservés dans le dépôt. Ils ne sont importés par aucun
  entrypoint et n'apparaissent donc pas dans le paquet construit.

  Télémétrie optionnelle, en opt-in (lib/telemetry.ts) : désactivée par
  défaut, aucune requête n'est jamais faite tant que l'utilisateur ne
  l'active pas depuis la page de réglages de l'extension. Une fois activée,
  un simple fetch() POST part vers PostHog (us.i.posthog.com/i/v0/e/) — pas
  de posthog-js, pas de script tiers, rien de plus qu'un corps JSON avec un
  nom d'événement, un identifiant aléatoire généré localement, et un
  ensemble fermé de propriétés (voir PRIVACY.md, « Statistiques d'usage
  anonymes »). Jamais le texte de la page, jamais son URL.
  ```

---

## Captures d'écran

Chrome et Edge : au moins une en 1280×800. Edge veut en plus un logo 300×300.

1. La bulle de sélection sur un article.
2. La pastille de lecture en cours, réglages ouverts.
3. Le menu contextuel avec les entrées d'Orateur.
