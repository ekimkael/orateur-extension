import { isProbablyReaderable, Readability } from "@mozilla/readability"

/** Aligné sur mobile/lib/article-import.ts pour que les durées concordent. */
const WORDS_PER_MINUTE = 200

const NOT_AN_ARTICLE = "Cette page ne contient pas d'article lisible."

/**
 * Éléments qui ne portent jamais de prose : médias interactifs, formulaires,
 * chrome de page.
 *
 * Ils sont retirés de la copie *avant* le scoring, sinon un menu latéral dense
 * peut remporter le concours de densité de texte de Readability.
 */
const INERT_SELECTORS = [
  "script,style,noscript,template",
  "iframe,object,embed,svg,canvas,video,audio",
  "form,button,input,select,textarea",
  "nav,aside,footer,dialog",
  "[role='navigation'],[role='complementary'],[role='banner']",
  "[role='dialog'],[role='alertdialog'],[role='search']",
  "[aria-hidden='true'],[hidden]",
].join(",")

/**
 * Conventions de nommage des parasites : pubs, encarts sponsorisés, boutons de
 * partage, blocs de commentaires, bandeaux cookies, popups, widgets
 * « à lire aussi ».
 *
 * « ad » est borné par `\b` — sans cela le motif emporterait « header »,
 * « download » ou « breadcrumb » — mais reste sensible aux séparateurs, ce qui
 * couvre `ad-slot`, `slot-ad` et `ads`.
 */
const NOISE_PATTERN =
  /\bads?\b|advert|sponsor|promo|share|social|comment|newsletter|subscribe|paywall|cookie|consent|popup|modal|sidebar|widget|related|recirc/i

/**
 * Au-delà de ce volume de texte, un bloc au nom suspect est probablement le
 * conteneur de l'article (« content-with-sidebar », « commentable-post ») et
 * non un parasite. Les gros parasites — fil de commentaires, colonne latérale —
 * sont déjà écartés par le scoring de Readability.
 */
const MAX_NOISE_LENGTH = 400

/** Blocs dont le texte est prononcé, dans l'ordre du document. */
const TEXT_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre"

/**
 * Métadonnées produites par Readability, réutilisées telles quelles : titre,
 * auteur (`byline`), date (`publishedTime`), extrait (`excerpt`), nom du site
 * (`siteName`), langue (`lang`), direction (`dir`).
 */
type ReadabilityMetadata = Omit<
  NonNullable<ReturnType<Readability["parse"]>>,
  "content" | "textContent"
>

export interface ExtractedArticle extends ReadabilityMetadata {
  /** HTML nettoyé, sans attributs de présentation. */
  content: string
  /** Texte prêt pour le TTS : un bloc par ligne, séparés par une ligne vide. */
  textContent: string
  url: string
  readingTimeMinutes: number
}

/**
 * Extrait l'article principal d'une page et le nettoie pour la lecture vocale.
 *
 * Le document d'origine n'est jamais modifié : tout le travail se fait sur une
 * copie. Aucun appel réseau n'est effectué.
 *
 * @throws {Error} si la page n'est pas un article (GitHub, dashboard, app web,
 * page trop pauvre en contenu).
 */
export function extractArticle(
  doc: Document,
  url = doc.location?.href ?? ""
): ExtractedArticle {
  const clone = doc.cloneNode(true) as Document
  remove(clone, INERT_SELECTORS)
  removeNoise(clone)

  // Filtre rapide (une seule passe, sans scoring) sur les pages non éditoriales.
  if (!isProbablyReaderable(clone)) throw new Error(NOT_AN_ARTICLE)

  const parsed = new Readability<Element>(clone, {
    // Le serializer renvoie le nœud plutôt qu'une chaîne : on nettoie l'arbre
    // en place au lieu de re-parser le HTML produit.
    serializer: (node) => node as Element,
    // Laisse NOISE_PATTERN filtrer la sortie ; les classes sont retirées après.
    keepClasses: true,
    // Même tolérance que l'import web (web/app/lib/article-import.ts).
    charThreshold: 120,
  }).parse()

  const root = parsed?.content
  if (!root) throw new Error(NOT_AN_ARTICLE)

  clean(root)
  const textContent = toSpeakableText(root)
  if (!textContent) throw new Error(NOT_AN_ARTICLE)

  return {
    ...parsed,
    content: root.innerHTML,
    textContent,
    length: textContent.length,
    siteName: parsed.siteName || hostnameOf(url) || null,
    lang: parsed.lang || doc.documentElement.lang || null,
    url,
    readingTimeMinutes: Math.max(
      1,
      Math.round(countWords(textContent) / WORDS_PER_MINUTE)
    ),
  }
}

function remove(scope: Document | Element, selectors: string) {
  // querySelectorAll renvoie une liste statique : supprimer pendant l'itération
  // est sûr, et retirer un parent rend `.remove()` inopérant sur ses enfants.
  for (const node of scope.querySelectorAll(selectors)) node.remove()
}

/**
 * Retire les parasites nommés, avant le scoring : Readability retague les
 * `<div>` purement textuels en `<p>` et perd leurs classes au passage, donc
 * filtrer sa sortie laisserait passer les encarts publicitaires.
 */
function removeNoise(scope: Document | Element) {
  for (const el of scope.querySelectorAll("[class],[id]")) {
    if ((el.textContent?.length ?? 0) >= MAX_NOISE_LENGTH) continue
    const name = `${el.getAttribute("class") ?? ""} ${el.id}`
    if (NOISE_PATTERN.test(name)) el.remove()
  }
}

function clean(root: Element) {
  remove(root, INERT_SELECTORS)
  removeNoise(root)

  // Les classes n'ont servi qu'au filtrage ci-dessus.
  for (const el of root.querySelectorAll("[class],[style],[id]")) {
    el.removeAttribute("class")
    el.removeAttribute("style")
    el.removeAttribute("id")
  }

  // Blocs vides : le TTS y marquerait une pause pour rien.
  for (const el of root.querySelectorAll(
    "p,div,span,li,blockquote,h1,h2,h3,h4,h5,h6"
  )) {
    if (!el.textContent?.trim() && !el.querySelector("img")) el.remove()
  }
}

/**
 * Aplatit le contenu en texte lisible à voix haute.
 *
 * Titres, paragraphes, items de liste et citations gardent chacun leur ligne :
 * `textContent` seul collerait la fin d'un titre au début du paragraphe suivant.
 * Les espaces internes sont normalisés pour éviter les coupures artificielles.
 */
function toSpeakableText(root: Element) {
  const text = Array.from(root.querySelectorAll(TEXT_BLOCKS))
    // Un <p> dans un <blockquote>, un <li> dans un <li> : déjà couvert par le
    // parent, qui est lui-même dans la sélection.
    .filter((el) => !el.parentElement?.closest("li,blockquote,pre"))
    .map((el) => normalize(el.textContent ?? ""))
    .filter(Boolean)
    .join("\n\n")

  return text || normalize(root.textContent ?? "")
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}
