/**
 * Retrouve, dans le DOM vivant, l'élément d'où vient chaque bloc lu.
 *
 * L'extraction travaille sur un clone (`extract-article.ts`) et n'en ressort
 * qu'une chaîne plate : aucune référence vers les nœuds de la page ne survit.
 * Marquer les éléments vivants avant le clonage donnerait la correspondance
 * exacte, mais au prix d'une mutation de la page — invariant explicite de
 * l'extracteur, et de quoi réveiller les MutationObservers du site. On les
 * retrouve donc par leur texte, à la volée.
 */

/**
 * Dupliqué de `extract-article.ts` (TEXT_BLOCKS) plutôt qu'importé : ce module
 * est appelé par reader.content.ts, chargé sur toutes les pages, et
 * extract-article.ts tire Readability derrière lui.
 *
 * Le filtre des blocs imbriqués de l'extracteur (un `<p>` dans un
 * `<blockquote>`) n'est pas repris : l'ordre du document présente le parent en
 * premier, et son texte commence par celui de l'enfant — c'est donc lui qui
 * gagne la comparaison, comme à l'extraction. L'enfant, lui, est simplement
 * dépassé par le curseur.
 */
const TEXT_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre"

/** Même normalisation que l'extracteur, sinon rien ne se compare. */
const normalize = (text: string) => text.replace(/\s+/g, " ").trim()

/**
 * Longueur de l'empreinte comparée.
 *
 * Comparer les textes entiers échouerait : l'extraction retire du clone les
 * éléments inertes et les parasites (boutons de partage, encarts) qui vivent
 * *dans* les paragraphes, donc son texte est souvent plus court que celui de
 * l'élément vivant. Un préfixe suffit à identifier un bloc et survit à ces
 * retraits, qui tombent presque toujours en fin de bloc.
 */
const FINGERPRINT = 80

/**
 * Empreinte d'un bloc lu.
 *
 * Le point final ajouté par `withStop()` aux titres et items de liste n'existe
 * pas dans le DOM : il tombe ici. Sans conséquence pour les blocs longs, dont
 * l'empreinte est tronquée bien avant.
 */
function fingerprint(block: string) {
  return normalize(block).replace(/[.…]$/, "").slice(0, FINGERPRINT)
}

/**
 * Ouvre une recherche sur un document, pour la durée d'une lecture.
 *
 * Le curseur n'avance que sur une correspondance et ne recule jamais : la
 * recherche du bloc *n* reprend là où celle du bloc *n−1* s'est arrêtée, donc
 * le coût total est amorti en une passe sur l'article. Un bloc introuvable —
 * un `<pre>`, remplacé par « Extrait de code. » à l'extraction — laisse le
 * curseur en place plutôt que de désynchroniser les suivants.
 */
export function createAnchorFinder(root: ParentNode) {
  const candidates = Array.from(root.querySelectorAll(TEXT_BLOCKS))
  // `textContent` alloue toute la chaîne du sous-arbre : sur un bloc
  // introuvable, on balaie la fin du document, et sans ce cache on la
  // renormaliserait à chaque bloc suivant.
  const texts = new Map<Element, string>()
  let cursor = 0

  function textOf(element: Element) {
    let text = texts.get(element)
    if (text === undefined) {
      text = normalize(element.textContent ?? "")
      texts.set(element, text)
    }
    return text
  }

  return function findAnchor(block: string): Element | null {
    const mark = fingerprint(block)
    if (!mark) return null
    for (let i = cursor; i < candidates.length; i++) {
      const element = candidates[i]!
      if (!textOf(element).startsWith(mark)) continue
      cursor = i + 1
      return element
    }
    return null
  }
}
