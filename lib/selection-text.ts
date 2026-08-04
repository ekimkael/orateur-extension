/** En dessous, c'est un clic parasite ou un double-clic raté, pas une intention. */
export const MIN_SELECTION_LENGTH = 3

/**
 * Le payload voyage dans un fragment d'URL, que les navigateurs acceptent bien
 * au-delà. La limite est éditoriale : ~16 min de synthèse. Au-delà, l'utilisateur
 * voulait probablement sauvegarder la page entière, pas une sélection.
 */
export const MAX_SELECTION_LENGTH = 20_000

export type SelectionError = "empty" | "too-short"

export type SelectionText =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: SelectionError }

const TEXT_NODE = 3

/**
 * Éléments dont le `textContent` n'est jamais de la prose.
 *
 * Une sélection large les emporte facilement : un triple-clic sur un article
 * ramène volontiers le `<script>` JSON-LD collé au dernier paragraphe.
 */
const INERT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "OBJECT",
  "EMBED",
])

/**
 * Balises qui imposent une rupture de paragraphe.
 *
 * Les cellules (TD, TH) en font partie : un tableau aplati d'une traite colle la
 * fin d'une cellule au début de la suivante. Tout ce qui n'est pas listé ici est
 * traité comme de l'inline — `<a>`, `<strong>`, `<span>` — et ne laisse que son
 * texte, sans l'URL ni le balisage.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
])

/**
 * Aplatit une sélection en texte prononçable.
 *
 * Firefox autorise plusieurs plages dans une même sélection (Ctrl+clic) ; elles
 * sont concaténées comme autant de blocs. Chaque plage est clonée : le document
 * de la page n'est jamais touché.
 */
export function rangesToText(ranges: Range[]) {
  return normalizeSelectionText(
    ranges.map((range) => extractSelectionText(range.cloneContents())).join("\n\n")
  )
}

/**
 * Convertit un arbre DOM en texte brut, un bloc par paragraphe.
 *
 * Aucune sortie n'est du HTML : le résultat est toujours une chaîne, jamais du
 * balisage réinjectable.
 */
export function extractSelectionText(node: Node) {
  const parts: string[] = []
  collect(node, parts)
  return normalizeSelectionText(parts.join(""))
}

function collect(node: Node, out: string[]) {
  if (node.nodeType === TEXT_NODE) {
    out.push(node.nodeValue ?? "")
    return
  }

  // Un DocumentFragment n'a pas de `tagName` : il n'est ni inerte ni bloc, on
  // descend simplement dans ses enfants.
  const tag = (node as Element).tagName
  if (tag) {
    if (INERT_TAGS.has(tag) || isHidden(node as Element)) return
    if (tag === "BR") {
      out.push("\n")
      return
    }
  }

  const isBlock = Boolean(tag) && BLOCK_TAGS.has(tag)
  if (isBlock) out.push("\n\n")
  for (const child of node.childNodes) collect(child, out)
  if (isBlock) out.push("\n\n")
}

/**
 * Le fragment cloné est détaché du document : `getComputedStyle` n'y renvoie
 * rien d'exploitable. Seuls les attributs restent lisibles.
 */
function isHidden(element: Element) {
  return (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true"
  )
}

/**
 * Normalise les blancs sans toucher au reste.
 *
 * Espaces, tabulations et insécables se valent à l'oral ; le saut de ligne est
 * le seul blanc qui porte du sens, puisqu'il sépare les blocs. Rien n'est
 * transcodé : accents, idéogrammes, arabe et emojis traversent intacts.
 */
export function normalizeSelectionText(raw: string) {
  return raw
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim()
}

/**
 * Décide si une sélection mérite d'être lue, et la borne.
 *
 * Une sélection trop longue n'est jamais refusée — l'utilisateur perdrait son
 * geste — mais tronquée, à charge de l'appelant de le signaler.
 */
export function validateSelectionText(raw: string): SelectionText {
  const text = normalizeSelectionText(raw)
  if (!text) return { ok: false, reason: "empty" }
  if (text.length < MIN_SELECTION_LENGTH) return { ok: false, reason: "too-short" }
  if (text.length <= MAX_SELECTION_LENGTH) return { ok: true, text, truncated: false }
  return { ok: true, text: truncate(text), truncated: true }
}

/**
 * Coupe au dernier espace disponible.
 *
 * Une langue sans espaces (japonais, chinois, thaï) n'en offre pas : on coupe
 * alors net, en écartant un substitut haut orphelin — la moitié d'un emoji ou
 * d'un idéogramme hors BMP — qui s'afficherait en caractère de remplacement.
 */
function truncate(text: string) {
  const head = text.slice(0, MAX_SELECTION_LENGTH)
  const boundary = head.lastIndexOf(" ")
  const cut =
    boundary > MAX_SELECTION_LENGTH * 0.9
      ? head.slice(0, boundary)
      : head.replace(/[\uD800-\uDBFF]$/, "")
  return cut.trimEnd()
}
