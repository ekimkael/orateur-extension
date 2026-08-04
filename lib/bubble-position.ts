/** Distance entre la bulle et la sélection. */
const GAP = 8

/** Marge minimale entre la bulle et le bord du viewport. */
const EDGE = 8

export interface Box {
  width: number
  height: number
}

export interface Rect extends Box {
  top: number
  left: number
}

/**
 * Place la bulle au-dessus de la sélection, centrée, sans jamais sortir du
 * viewport.
 *
 * Les coordonnées sont relatives au viewport — celles que renvoie
 * `getBoundingClientRect` — et destinées à un élément `position: fixed`. Ce seul
 * choix évacue le scroll vertical et horizontal, le zoom navigateur et le ratio
 * de pixels : le navigateur les a déjà appliqués au rectangle reçu.
 *
 * Le sens d'écriture n'entre pas non plus en jeu : une sélection RTL produit un
 * rectangle dont `left` est déjà le bord gauche visuel.
 */
export function placeBubble(selection: Rect, bubble: Box, viewport: Box) {
  const above = selection.top - GAP - bubble.height

  return {
    // Au-dessus tant qu'il y a la place, sinon dessous : c'est le haut de la
    // sélection multi-lignes qui compte, pas son milieu.
    top: clamp(
      above >= EDGE ? above : selection.top + selection.height + GAP,
      EDGE,
      viewport.height - bubble.height - EDGE
    ),
    left: clamp(
      selection.left + selection.width / 2 - bubble.width / 2,
      EDGE,
      viewport.width - bubble.width - EDGE
    ),
  }
}

/**
 * Un viewport plus petit que la bulle rend `max` inférieur à `min` : le bord
 * haut/gauche reste alors le repli le moins mauvais.
 */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
