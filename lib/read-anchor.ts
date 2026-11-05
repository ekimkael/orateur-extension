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
 * Les conteneurs des mails sont inclus : leur prose n'est pas toujours dans
 * un p. Parmi les correspondances imbriquées, préférer le bloc le plus précis.
 */
const TEXT_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre,div,section,td,th"

/**
 * Emoji, as `extract-article.ts` drops them from X posts: the read text loses
 * a leading 🛑 the page keeps. Duplicated for the same reason as TEXT_BLOCKS.
 */
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}]/gu

/** Même normalisation que l'extracteur, sinon rien ne se compare. */
const normalize = (text: string) => text.replace(EMOJI, "").replace(/\s+/g, " ").trim()

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
      let match = i
      for (let j = i + 1; j < candidates.length && element.contains(candidates[j]!); j++) {
        if (textOf(candidates[j]!).startsWith(mark)) {
          match = j
          break
        }
      }
      // Repartir du descendant pour descendre encore si nécessaire.
      if (match !== i) {
        i = match - 1
        continue
      }
      cursor = i + 1
      return element
    }
    return null
  }
}

/**
 * Index du bloc lu qui commence là où l'utilisateur a cliqué.
 *
 * On remonte depuis la cible plutôt que de rejouer `createAnchorFinder` depuis
 * le début : sur Wikipédia, les cellules courtes de l'infobox (« Proconsul. »)
 * trouvent un écho bien plus loin dans la page — un titre de section — et le
 * curseur, qui ne recule jamais, saute par-dessus le paragraphe visé. Partir
 * de la cible ne dépend d'aucun bloc antérieur. Parmi les empreintes qui
 * conviennent, la plus longue : « Cicéron » est aussi le début de « Cicéron,
 * dont le nom romain… ».
 */
export function findBlockIndex(root: ParentNode, blocks: string[], target: Element | null) {
  const marks = blocks.map(fingerprint)
  for (let element = target?.closest(TEXT_BLOCKS); element && root.contains(element); element = element.parentElement?.closest(TEXT_BLOCKS)) {
    const text = normalize(element.textContent ?? "")
    let best = -1
    marks.forEach((mark, index) => {
      if (mark && text.startsWith(mark) && (best < 0 || mark.length > marks[best]!.length)) best = index
    })
    if (best >= 0) return best
  }
  return -1
}

/** Letters and digits: what survives every cleaning the extractor applies. */
const WORD = /[\p{L}\p{N}]/u

/** How many letters and digits identify a block inside its element. */
const RANGE_MARK = 24

const letters = (text: string) => text.split("").filter((c) => WORD.test(c)).join("")

/**
 * The letters and digits of an element's text, each with the text node and
 * offset it sits at, and whether it opens a line (no letter or digit between
 * it and the previous "\n" or the element's start).
 */
function skeleton(element: Element) {
  const chars: string[] = []
  const nodes: Text[] = []
  const offsets: number[] = []
  const opens: boolean[] = []
  let fresh = true
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      const c = node.data[i]!
      if (c === "\n") fresh = true
      else if (WORD.test(c)) {
        chars.push(c)
        nodes.push(node)
        offsets.push(i)
        opens.push(fresh)
        fresh = false
      }
    }
  }
  return { text: chars.join(""), nodes, offsets, opens }
}

/**
 * The part of `element` that reads `block`: from the line where it starts to
 * where `next` starts, or to the element's end.
 *
 * An X post keeps all its paragraphs in one element, split by "\n", so the
 * element alone would light the whole post while one paragraph is read.
 * Blocks are matched on letters and digits only, because the read text has
 * lost the post's emoji, URLs and `#`/`@` signs. A block must open a line:
 * a short heading ("Introduction") also appears mid-sentence in the paragraph
 * before it. Null when the block does not start a line of the element, or
 * when it is the whole element.
 */
export function blockRange(element: Element, block: string, next?: string): Range | null {
  const found = locate(element, block, next)
  if (!found) return null
  const { page, start, end } = found
  // The block is the whole element: the caller lights and scrolls the
  // element itself, which also follows nested scrollers.
  if (start === 0 && end < 0) return null
  const range = element.ownerDocument.createRange()
  range.setStart(page.nodes[start]!, page.offsets[start]!)
  if (end < 0) range.setEnd(element, element.childNodes.length)
  else range.setEnd(page.nodes[end]!, page.offsets[end]!)
  return range
}

/**
 * Whether `element` also holds `next` after `block`: an X post's lines. Same
 * matching as `blockRange`, so the follower and live-page agree on it.
 */
export function holdsNext(element: Element, block: string, next: string): boolean {
  return (locate(element, block, next)?.end ?? -1) >= 0
}

/** Where `block`, then `next`, open a line of `element`, in skeleton indexes. */
function locate(element: Element, block: string, next?: string) {
  const page = skeleton(element)
  const find = (text: string, from: number) => {
    const mark = letters(text).slice(0, RANGE_MARK)
    if (!mark) return -1
    for (let at = page.text.indexOf(mark, from); at >= 0; at = page.text.indexOf(mark, at + 1)) {
      if (page.opens[at]) return at
    }
    return -1
  }
  const start = find(block, 0)
  if (start < 0) return null
  return { page, start, end: next === undefined ? -1 : find(next, start + 1) }
}
