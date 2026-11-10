import { blockRange, createAnchorFinder } from "../../lib/read-anchor.ts"

/** Nom du surlignage dans le registre du document. */
const HIGHLIGHT_NAME = "orateur-reading"

/**
 * Fond translucide, et rien d'autre : la couleur du texte reste celle de la
 * page, donc son contraste aussi, et la même teinte tient sur fond clair comme
 * sur fond sombre. Vit dans le document de la page, hors de portée des tokens
 * du shadow root — donc en dur, mais alignée sur --primary de la charte
 * (même formule que ::selection, entrypoints/options/style.css).
 */
const HIGHLIGHT_CSS = `::highlight(${HIGHLIGHT_NAME}){background-color:rgb(245 78 0 / 0.3)}`

/**
 * Silence du défilement automatique après un geste de l'utilisateur : le
 * temps de deux ou trois paragraphes, de quoi relire un passage sans que la
 * page reparte toute seule.
 */
const MANUAL_SCROLL_GRACE = 10_000

/**
 * Gestes qui valent reprise en main du défilement.
 *
 * Jamais `scroll` : l'événement ne dit pas qui a scrollé, nos propres
 * `scrollIntoView` se prendraient donc eux-mêmes pour un geste de
 * l'utilisateur et le suivi s'arrêterait au premier paragraphe.
 */
const SCROLL_GESTURES = ["wheel", "touchmove", "keydown"] as const

/**
 * Suit la lecture sur la page : surligne le paragraphe lu, et l'amène dans le
 * champ de vision quand il n'y est pas.
 *
 * L'API CSS Custom Highlight plutôt que des `<span>` posés autour du texte :
 * elle ne peut peindre que le fond, la couleur et la décoration — donc aucun
 * recalcul de mise en page, aucune mutation du DOM de la page (rien à faire
 * passer par Trusted Types, rien qu'un rendu React du site puisse effacer,
 * aucun sélecteur CSS de la page cassé), et une seule repeinte par
 * paragraphe.
 */
export function createFollower() {
  // Chrome 105, Safari 17.2, Firefox 140. Ailleurs on lit sans suivre, plutôt
  // que d'embarquer un polyfill qui, lui, mutera la page.
  const supported = typeof Highlight === "function" && typeof CSS !== "undefined" && "highlights" in CSS

  let sheet: CSSStyleSheet | null = null
  let highlight: Highlight | null = null
  let findAnchor: ReturnType<typeof createAnchorFinder> | null = null
  let pageAnchors: readonly (Element | null)[] | undefined
  let blocks: string[] = []
  /** Dernier paragraphe surligné : évite de rechercher deux fois le même. */
  let current = -1
  let anchor: Element | null = null
  /** The part of `anchor` being read, when it holds more than this block. */
  let part: Range | null = null
  let enabled = true
  let lastGesture = 0

  const noteGesture = () => {
    lastGesture = Date.now()
  }

  /** Ouvre le suivi sur les blocs d'une lecture. Idempotent. */
  function begin(paragraphs: string[], anchors?: readonly (Element | null)[]) {
    if (!supported) return
    end()
    blocks = paragraphs
    pageAnchors = anchors
    findAnchor = createAnchorFinder(document)
    if (!sheet) {
      // Feuille construite plutôt qu'un `<style>` injecté : rien à soumettre à
      // la directive `style-src` de la page, et rien à retirer de son DOM.
      sheet = new CSSStyleSheet()
      sheet.replaceSync(HIGHLIGHT_CSS)
    }
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    highlight = new Highlight()
    CSS.highlights.set(HIGHLIGHT_NAME, highlight)
    for (const gesture of SCROLL_GESTURES) {
      window.addEventListener(gesture, noteGesture, { passive: true })
    }
  }

  /** Surligne le paragraphe `index`, et l'amène à l'écran s'il n'y est pas. */
  function show(index: number) {
    if (!findAnchor || index === current) return
    current = index
    const block = blocks[index]
    // Bloc introuvable dans la page — un `<pre>`, dit « Vous pouvez avoir un aperçu en regardant le code ci-dessous. » —
    // le paragraphe précédent reste surligné plutôt que rien : la lecture est
    // bien là, quelque part entre les deux.
    const own = block === undefined ? null : pageAnchors ? pageAnchors[index] ?? null : findAnchor(block)
    // An X post keeps all its paragraphs in one element: only the first is
    // found on its own, the next ones are lines of the element already lit.
    const element = own ?? anchor
    const range = element && block !== undefined ? blockRange(element, block, blocks[index + 1]) : null
    if (!own && !range) return
    anchor = element
    part = range
    if (anchor && enabled) paint(anchor, part)
  }

  /** Lights `range`, or the whole element when the block has no range of its own. */
  function paint(element: Element, range: Range | null) {
    if (!highlight) return
    const lit = range ?? document.createRange()
    if (!range) lit.selectNodeContents(element)
    highlight.clear()
    highlight.add(lit)
    reveal(element, range)
  }

  function reveal(element: Element, range: Range | null) {
    if (Date.now() - lastGesture < MANUAL_SCROLL_GRACE) return
    const box = (range ?? element).getBoundingClientRect()
    // Déjà en vue : le haut du bloc est à l'écran, dans les deux premiers
    // tiers. Le haut plutôt que le bloc entier — un paragraphe plus haut que
    // la fenêtre ne rentre jamais, et la page défilerait à chaque fois.
    if (box.top >= 0 && box.top <= window.innerHeight * 0.66) return
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    // shortcut: a range cannot scrollIntoView, so a paragraph inside a post
    // scrolls the window; enough for X, upgrade if a nested scroller needs it.
    if (range) window.scrollBy({ top: box.top - window.innerHeight / 3, behavior })
    // `center` et pas `start` : un en-tête collant masque le haut de la
    // fenêtre sur la moitié des sites.
    else element.scrollIntoView({ block: "center", behavior })
  }

  /** Le réglage a changé pendant la lecture. */
  function setEnabled(value: boolean) {
    if (value === enabled) return
    enabled = value
    if (!enabled) highlight?.clear()
    else if (anchor) paint(anchor, part)
  }

  /** Rend la page à elle-même : plus de surlignage, plus d'écouteur. */
  function end() {
    blocks = []
    findAnchor = null
    pageAnchors = undefined
    anchor = null
    part = null
    current = -1
    if (highlight) {
      highlight.clear()
      CSS.highlights.delete(HIGHLIGHT_NAME)
      highlight = null
    }
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)
    }
    for (const gesture of SCROLL_GESTURES) window.removeEventListener(gesture, noteGesture)
  }

  return { begin, show, setEnabled, end }
}
