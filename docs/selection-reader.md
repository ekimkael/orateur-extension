# Lecture de texte sélectionné

Sélectionner du texte sur n'importe quelle page et le faire lire par Orateur,
soit par le menu contextuel, soit par une bulle flottante.

## Ce que la feature fait — et ne fait pas

L'extension **ne contient aucun lecteur**. Elle n'a ni TTS, ni player, ni store :
son unique rôle est d'extraire du contenu et de le transmettre à l'application
web, qui possède déjà tout cela.

```
Sélection → extraction texte → validation → fragment d'URL → /articles/new
```

La lecture de sélection réutilise donc exactement le chemin de la sauvegarde
d'article : `buildImportUrl()` encode le payload dans le fragment, `/articles/new`
le lit via `readExtensionImport()` et préremplit le formulaire d'import. Rien
n'est dupliqué.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `lib/selection-text.ts` | Extraction DOM → texte brut, normalisation, validation, troncature. Pur, testé. |
| `lib/bubble-position.ts` | Placement de la bulle dans le viewport. Pur, testé. |
| `lib/handoff.ts` | `textToParagraphHtml()` en plus de l'existant : texte → paragraphes échappés. |
| `entrypoints/selection.content.ts` | Détection de sélection, bulle flottante, réponse au background. |
| `entrypoints/background.ts` | Entrée de menu contextuel, réception des actions, ouverture du lecteur. |

## Les deux flux

**Menu contextuel** — l'entrée « Lire avec Orateur » est déclarée en
`contexts: ["selection"]`, donc le navigateur ne l'affiche que sur une sélection.
Au clic, le background interroge le content script du frame concerné
(`info.frameId`) pour obtenir un texte propre, et retombe sur
`info.selectionText` si le script n'est pas là.

**Bulle flottante** — le content script écoute `mouseup`, `mousedown` et `keyup`
sur le document. Au relâchement, il lit la sélection dans le tour suivant (elle
n'est pas arrêtée avant), et affiche la bulle. Le clic envoie
`{ type: "orateur:selection-action", action: "read", text, title, lang }` au
background.

## Décisions

**Le texte voyage échappé, en paragraphes HTML.** Côté web,
`createStoredArticleFromImport` interprète `content` comme du HTML dès qu'il y
repère du balisage : envoyer le texte brut ferait avaler un `<div>` sélectionné
sur une page de documentation. `textToParagraphHtml()` échappe `&`, `<` et `>`
puis emballe chaque bloc dans un `<p>` — le trajet est réversible et aucun
fragment de la page ne peut revenir comme du balisage. La sélection est traitée
en donnée non fiable de bout en bout ; rien n'est jamais construit par
`innerHTML`.

**La bulle coûte l'accès à toutes les pages.** Le reste de l'extension tient sur
`activeTab` seul, sans avertissement à l'installation. La bulle doit être là
*avant* le geste de l'utilisateur, donc son content script déclare
`matches: ["<all_urls>"]` — ce qui déclenche l'avertissement « lire et modifier
vos données sur tous les sites ». Le menu contextuel, lui, ne coûte rien.
Retirer la bulle rendrait la permission inutile ; l'inverse n'est pas vrai.

**Une lecture déjà en cours n'est pas gérée ici.** Chaque action ouvre un onglet
vers `/articles/new`, comme la sauvegarde d'article. C'est Orateur qui arbitre —
l'extension n'a pas d'état de lecture à consulter et ne doit pas s'en inventer un.

**Trois écouteurs permanents, pas un de plus.** Pas de `MutationObserver`, pas de
`selectionchange` (qui se déclenche à chaque déplacement du caret), pas de
recalcul périodique. Les écouteurs volatils — `scroll`, `blur`,
`visibilitychange` — ne sont branchés que pendant que la bulle est visible et
retirés d'un seul `AbortController.abort()`.

**Coordonnées viewport + `position: fixed`.** `getBoundingClientRect()` a déjà
appliqué le scroll, le zoom navigateur et le ratio de pixels. Le placement n'a
donc rien à en savoir, ce qui rend `placeBubble()` purement arithmétique et
testable.

## Cycle de vie de la bulle

Elle disparaît sur : clic ailleurs (`mousedown` hors de l'hôte), nouvelle
sélection, sélection vide, `Escape`, scroll, perte de focus de la fenêtre,
changement d'onglet, et invalidation du contexte d'extension.

Elle ne bloque pas la sélection : le `mousedown` du bouton appelle
`preventDefault()` pour que le caret ne se déplace pas, et l'hôte est en
`position: fixed`, hors du flux de la page.

## Accessibilité

Le bouton est un `<button>` natif dans un shadow root — il porte donc déjà
`role="button"`, l'activation par Entrée/Espace et la navigation au clavier, sans
ARIA redondant. Un `aria-label` complet remplace le libellé court. Le focus n'est
jamais volé : le prendre effacerait la sélection. `prefers-reduced-motion`
supprime l'animation d'apparition.

## Limites connues

| Situation | Comportement |
| --- | --- |
| iframe same-origin **et** cross-origin | Fonctionne : `allFrames: true` donne à chaque frame sa propre instance, aucune traversée de frontière. |
| Shadow DOM ouvert | Fonctionne, la sélection traverse. |
| Shadow DOM fermé | La sélection n'est pas exposée par le navigateur ; la bulle ne s'affiche pas. |
| Visionneuse PDF | Aucun content script n'y tourne. Le menu contextuel retombe sur `info.selectionText`. |
| Google Docs | Texte peint dans un canvas, rien de sélectionnable au sens du DOM. Sans effet. |
| `<input>` / `<textarea>` | Supportés via `selectionStart`/`selectionEnd` ; la bulle s'ancre sur le champ. |
| `contenteditable` (Notion, CMS) | Supporté par le chemin normal. |
| Pages internes (`about:`, boutiques d'extensions) | Aucun content script possible, par conception du navigateur. |
| SPA (React, Vue, Angular) | Aucune dépendance au DOM initial : les écouteurs sont sur `document`, la navigation client ne casse rien. |
| Sélection > 20 000 caractères | Tronquée à une frontière de mot, avec un badge d'avertissement. Jamais refusée. |

## Ajouter une action

« Traduire », « Résumer », « Sauvegarder » :

1. Ajouter une entrée à `ACTIONS` dans `entrypoints/selection.content.ts`.
2. Ajouter un cas dans le `if (message.action === …)` du background.

La bulle et le menu contextuel ne portent aucune logique métier : ils
transmettent un identifiant d'action et du texte.

## Tests

`npm test` couvre l'extraction (paragraphes, styles inline, listes, tableaux,
liens, éléments inertes, `<br>`, Unicode/emoji), la validation (vide, blancs
seuls, minimum, troncature sans casser de paire de substituts), les plages
multiples de Firefox, l'échappement HTML et le placement de la bulle (basculement
haut/bas, recadrage gauche/droite, viewport plus petit que la bulle).

Le reste — apparition réelle de la bulle, ouverture du lecteur — relève du
manuel : `npm run dev`, puis les scénarios du tableau des limites ci-dessus.
