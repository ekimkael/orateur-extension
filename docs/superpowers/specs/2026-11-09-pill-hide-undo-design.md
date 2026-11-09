# Croix de la pastille : masquage annulable — design

Date : 2026-11-09. Statut : validé le 2026-11-09 — action optimiste + annulation, toast « Orateur masqué sur ce site · Annuler » / « Orateur hidden on this site · Undo », ligne a dans `PRIVACY.md`, 5 s.

## Intention

Au repos, la croix de la pastille (infobulle « Ne plus afficher Orateur sur ce site ») masque Orateur sur le domaine : la pastille disparaît sur-le-champ, le site entre dans les sites masqués, et la bulle de sélection disparaît aussi (`entrypoints/selection.content.ts` lit la même liste). Il n'y a ni retour visuel ni annulation, et seul l'onglet Sites des réglages permet de revenir en arrière. La croix est collée au bouton ▶ : un clic par erreur coûte un détour par les réglages.

Objectif : dire ce qui vient de se passer, permettre d'annuler en un geste, et mesurer combien de masquages sont annulés.

Hors périmètre : la croix pendant une lecture, qui est un ⏹ et ne masque rien ; l'onglet Sites des réglages ; déplacer la croix.

## Comportement attendu

1. Clic sur la croix au repos (ou en erreur) : la pastille se transforme sur place en toast « [formulation retenue] · Annuler ».
2. « Annuler » rétablit la pastille au repos et retire le site de la liste. La bulle de sélection revient avec elle.
3. Sans action, le toast part après 5 s et la pastille est détachée, comme aujourd'hui.
4. Le délai s'arrête tant que la souris survole le toast ou que le focus y est, et tant que l'onglet est caché (`visibilitychange`).
5. Échap ferme le toast tout de suite, sans annuler.
6. Accessibilité : le toast a `role="status"`. Au clavier, le focus passe de la croix au bouton « Annuler » ; au départ du toast, il retourne au document.
7. Mouvement : la largeur se transforme avec l'animation de mise en page existante (`animateLayout`, courbe `cubic-bezier(0.23, 1, 0.32, 1)`). Sortie en 150 ms par opacité et `scale(0.95)`. Avec `prefers-reduced-motion`, uniquement des fondus.
8. Télémétrie : `pill_hidden` au clic sur la croix, `pill_hide_undone` sur « Annuler ». Aucune propriété, jamais le domaine (AGENTS.md : pas d'URL dans la télémétrie).

## Options comparées

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct, sans pattern : `alert()` après le masquage | Dit ce qui s'est passé. | Bloque la page et fige l'animation de la pastille (`confirm()` est déjà évité pour cette raison dans `lib/reading-session.ts`) ; un « OK » qui ne laisse aucun choix ; un clic par erreur n'est toujours pas rattrapé. |
| Confirmation préalable (croix en deux temps : « Masquer sur ce site ? ») | Évite les masquages accidentels. | Une friction de plus à chaque masquage voulu ; c'est l'utilisateur qui décide, il n'a pas à se justifier. |
| Action optimiste + commande d'annulation (retenue) | Le site est écrit tout de suite (`addHiddenSite`) ; « Annuler » applique l'action inverse (`removeHiddenSite`). | Un état « masqué, annulable » dans la vue : pendant le toast, cet onglet ignore son propre changement de liste. Les autres onglets du site se masquent tout de suite, puis réapparaissent en cas d'annulation. |
| Validation différée (type « Annuler l'envoi » de Gmail) | Le site n'est écrit qu'à la fin du toast ; « Annuler » annule juste le minuteur. | Une fermeture ou une navigation pendant les 5 s perd le masquage (il faudrait l'écrire au `pagehide`) ; les autres onglets du site gardent leur pastille 5 s de plus. |

Recommandation : action optimiste + annulation. Le choix de l'utilisateur est enregistré dès le clic, quoi qu'il arrive à l'onglet. « Annuler » réutilise `removeHiddenSite`, et l'écouteur `onHiddenSitesChanged` de `entrypoints/reader.content/index.ts` rattache déjà la pastille quand le site sort de la liste.

## Conception

- **`entrypoints/reader.content/index.ts`** : `onSecondary` au repos appelle `track({ name: "pill_hidden" })`, `addHiddenSite(location.hostname)` et `pill.confirmHidden(undo)`, au lieu de `pill.detach()`. `undo` appelle `removeHiddenSite(normalizeSite(location.hostname))` et `track({ name: "pill_hide_undone" })`. Pendant le toast, l'écouteur de sites masqués ne détache pas la pastille ; il le fait si le site reste masqué une fois le toast parti.
- **`entrypoints/reader.content/pill.ts`** : `confirmHidden(onUndo)` affiche le toast dans le même shadow root fermé, gère le minuteur (pause au survol, au focus, onglet caché), Échap, le focus, puis appelle `detach()` à la fin ou rétablit l'état repos sur « Annuler ». La session ne voit pas ce toast : c'est un état de vue, pas un `ReaderViewState`.
- **`entrypoints/reader.content/styles.ts`** : styles du toast, avec les tokens de la charte déjà utilisés par la pastille.
- **`lib/telemetry.ts`** : les deux événements dans l'union et la liste blanche, sans propriété.
- **`public/_locales/{en,fr}/messages.json`** : message du toast, libellé « Annuler » / « Undo ». Pas de tiret dans les noms de clés.
- **Docs** : `docs/analytics.md` (deux lignes), `PRIVACY.md` (une catégorie), `docs/selection-reader.md` si elle décrit le masquage.

## Texte visible, à choisir

Toast (FR / EN), à la place de la pastille, donc court :

1. « Orateur masqué sur ce site · Annuler » / « Orateur hidden on this site · Undo »
2. « Orateur ne s'affichera plus ici · Annuler » / « Orateur won't show here again · Undo »
3. « Masqué sur ce site, réactivable dans les réglages · Annuler » / « Hidden on this site, turn back on in Settings · Undo »
4. « Pastille masquée pour ce site · Annuler » / « Reader hidden for this site · Undo »

La 4 est inexacte : la bulle de sélection disparaît aussi. La 3 est la seule qui dit où revenir après les 5 s, mais elle est longue pour une pastille ; la 1 est la plus courte qui reste exacte.

Nouvelle ligne dans la liste des événements de `PRIVACY.md` :

- a. « Hiding Orateur on a site from the reading pill, and undoing it; the site is never sent. »
- b. « Uses of the pill's close button and of its Undo action, without the site's address. »
- c. « Hiding the reading pill and selection bubble on a site, and undoing that choice, without naming the site. »

## Tests et validation

- E2E Chrome et Firefox (`tests/e2e/main.test.mjs`) :
  - clic sur la croix → toast visible, site enregistré ;
  - « Annuler » → pastille rétablie, liste vide ;
  - expiration → pastille détachée, site toujours enregistré ;
  - Échap → toast fermé, site toujours enregistré.
  Le délai du toast est injectable pour ne pas attendre 5 s dans les tests.
- `lib/telemetry.test.ts` : les deux événements acceptés sans propriété, refusés avec une propriété.
- Vérification visible dans Chrome et Firefox : transformation pastille → toast, mouvement réduit, focus clavier.

## Décisions

1. Action optimiste + annulation.
2. Toast : formulation 1. `PRIVACY.md` : ligne a.
3. Durée : 5 s, avec pause au survol, au focus et onglet caché.
