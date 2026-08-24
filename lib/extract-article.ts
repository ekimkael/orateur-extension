import { isProbablyReaderable, Readability } from "@mozilla/readability"
// Extension explicite : `node --test` résout les modules sans elle, contrairement
// à Vite. Même raison que l'import de `pronunciation/index.ts` dans le lecteur.
import { withStop } from "./reading-intro.ts"

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

/**
 * Retire `class`/`id` des titres avant que Readability ne les évalue.
 *
 * Sa regex interne `unlikelyCandidates` contient `header` — pensée pour un
 * bandeau de page, elle attrape aussi un `<h2 class="header">` qui n'est qu'un
 * sous-titre stylé, et fait disparaître le nœud entier avant même la sélection
 * du contenu principal. Observé sur stackoverflow.blog : les quatre titres
 * d'un article y disparaissaient, affichage *et* lecture. `removeNoise` a déjà
 * eu sa chance de juger les titres sur nos propres motifs (« related »,
 * « widget »…) ; ce qui en réchappe passe pour du contenu.
 *
 * Contrepartie assumée : un vrai parasite absent de NOISE_PATTERN — fil de
 * navigation, pagination, bandeau RGPD — mais porté par un titre passera aussi.
 * Aucun cas observé pour l'instant.
 */
function desarmHeadings(scope: Document | Element) {
  for (const heading of scope.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    heading.removeAttribute("class")
    heading.removeAttribute("id")
  }
}

/** Blocs dont le texte est prononcé, dans l'ordre du document. */
const TEXT_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre"

/**
 * Mêmes blocs, plus les `<div>` feuilles — pour le repli `visibleText` (jalon 5)
 * uniquement. Gmail, Substack et consorts ne posent pas de `<p>` : sans cet
 * ajout, aucun bloc ne matcherait et `toSpeakableText` retomberait sur
 * `root.textContent`, un pavé d'un seul tenant sans découpe, donc sans
 * surlignage ni reprise de position possibles.
 */
const FALLBACK_BLOCKS = `${TEXT_BLOCKS},div:not(:has(p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6))`

/**
 * Sous ce volume de texte, le repli n'a plus de sens : un dashboard ou une
 * arborescence GitHub ont quelques mots visibles (libellés, noms de fichiers)
 * sans être une page à lire.
 */
const MIN_FALLBACK_LENGTH = 400

/**
 * Ce qui est dit à la place d'un bloc de code.
 *
 * Lire un extrait à voix haute, c'est énoncer sa ponctuation, son indentation
 * et ses identifiants : le web n'en dit rien (`sequence-builder.ts`,
 * `case "code": return []`) et mobile ne le collecte pas. Le silence complet
 * laisse un tutoriel amputé sans le dire, d'où l'annonce.
 *
 * Aucune position annoncée : le suivi de lecture retrouve les blocs dans la
 * page par leur texte (lib/read-anchor.ts), et celui-ci n'est pas celui du
 * `<pre>` — le surlignage reste donc sur le paragraphe précédent, et
 * « ci-dessous » ne désignerait rien de sûr.
 *
 * Même convention que `reading-intro` : code sur deux lettres, français par
 * défaut — le français est la valeur de repli, pas une entrée de la table.
 */
const CODE_NOTICE = "Extrait de code."
const CODE_NOTICE_BY_LANGUAGE: Record<string, string> = {
  en: "Code snippet.",
  es: "Fragmento de código.",
  de: "Codeausschnitt.",
  it: "Frammento di codice.",
  pt: "Excerto de código.",
}

/**
 * Mention de durée posée en tête d'article par la plupart des CMS. Bornée en
 * longueur pour ne pas emporter une phrase qui parlerait de lecture.
 *
 * Porté de mobile (`extract-blocks.ts`), élargi au français : « 5 min de
 * lecture » y est plus courant que « 5 min read ».
 */
const READING_TIME = /\d+\s*min(?:ute)?s?\s*(?:de lecture|read)|temps de lecture/i
const MAX_READING_TIME_LENGTH = 120

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
  desarmHeadings(clone)

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

  const lang = parsed.lang || doc.documentElement.lang || null

  clean(root)
  const textContent = toSpeakableText(root, lang ?? "")
  if (!textContent) throw new Error(NOT_AN_ARTICLE)

  return {
    ...parsed,
    title: parsed.title ? stripSiteSuffix(parsed.title) : parsed.title,
    content: root.innerHTML,
    textContent,
    length: textContent.length,
    siteName: parsed.siteName || hostnameOf(url) || null,
    lang,
    url,
    readingTimeMinutes: Math.max(
      1,
      Math.round(countWords(textContent) / WORDS_PER_MINUTE)
    ),
  }
}

/**
 * Texte visible de la page, quand ce n'est pas un article — jalon 5.
 *
 * Même nettoyage que `extractArticle` (INERT_SELECTORS, removeNoise,
 * desarmHeadings) puis même aplatissement, mais sans passer par Readability :
 * Gmail, Substack et les docs n'ont pas de conteneur d'article à trouver, mais
 * ont de la prose à lire. Rend `""` en dessous de MIN_FALLBACK_LENGTH — sans
 * ce plancher, un dashboard ou une arborescence GitHub se feraient lire leurs
 * quelques libellés visibles.
 *
 * Le document d'origine n'est jamais modifié, comme `extractArticle`.
 */
export function visibleText(doc: Document): { text: string; lang: string | null } {
  const clone = doc.cloneNode(true) as Document
  remove(clone, INERT_SELECTORS)
  removeNoise(clone)
  desarmHeadings(clone)

  const root = clone.body
  const lang = doc.documentElement.lang || null
  if (!root) return { text: "", lang }

  const text = toSpeakableText(root, lang ?? "", FALLBACK_BLOCKS)
  return { text: text.length >= MIN_FALLBACK_LENGTH ? text : "", lang }
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
function toSpeakableText(root: Element, lang: string, blockSelector = TEXT_BLOCKS) {
  const notice = CODE_NOTICE_BY_LANGUAGE[lang.slice(0, 2)] ?? CODE_NOTICE
  const blocks = Array.from(root.querySelectorAll(blockSelector))
    // Un <p> dans un <blockquote>, un <li> dans un <li> : déjà couvert par le
    // parent, qui est lui-même dans la sélection.
    .filter((el) => !el.parentElement?.closest("li,blockquote,pre"))
    .map((el) => {
      const text = normalize(el.textContent ?? "")
      // Le code est annoncé, pas prononcé. Un <pre> vide n'annonce rien : le
      // filtre suivant emporte la chaîne vide.
      return { el, text: el.tagName === "PRE" ? text && notice : text }
    })
    .filter(
      ({ text }) =>
        text && !(text.length <= MAX_READING_TIME_LENGTH && READING_TIME.test(text))
    )
    // Code, sortie, code : le motif est la norme dans un tutoriel, et sans cette
    // fusion la voix répète l'annonce trois fois de suite. Deux blocs séparés
    // par un paragraphe restent annoncés deux fois.
    .filter(({ el }, index, all) => el.tagName !== "PRE" || all[index - 1]?.el.tagName !== "PRE")

  // Ponctuation en dernier : titres, items de liste et légendes ne finissent
  // jamais par un point dans le HTML, et la voix enchaîne alors sur le bloc
  // suivant comme si la phrase continuait. Après le rognage, lui, qui reconnaît
  // les étiquettes de fin d'article *à* leur absence de ponctuation.
  const text = pruneTrailingResidue(blocks)
    .map(({ text }) => withStop(text))
    .join("\n\n")

  return text || normalize(root.textContent ?? "")
}

/**
 * Rogne ce que les encarts retirés laissent en fin d'article : titres orphelins
 * (« À lire aussi », « Sur le même sujet ») et étiquettes courtes sans
 * ponctuation finale.
 *
 * Une vraie phrase de conclusion est ponctuée : le rognage s'arrête au premier
 * bloc qui ressemble à de la prose. Porté de mobile
 * (`pruneTrailingWidgetResidue`), aux mêmes seuils.
 */
function pruneTrailingResidue(blocks: Array<{ el: Element; text: string }>) {
  const isResidue = ({ el, text }: { el: Element; text: string }) =>
    /^H[1-6]$/.test(el.tagName) ||
    (el.tagName === "P" && text.length <= 60 && !/[.!?…"»›)\]]$/.test(text))

  // Le dernier bloc de prose, plus un : tout ce qui suit est du résidu. Aucun
  // bloc de prose vaut -1, donc un article entièrement rogné.
  return blocks.slice(0, blocks.map(isResidue).lastIndexOf(false) + 1)
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Retire le nom du site accolé au titre : « Le titre | Mon Journal ».
 *
 * Readability découpe déjà sur ce séparateur, mais restitue le titre entier dès
 * que le reste tombe à quatre mots ou moins — le suffixe se dirait alors à voix
 * haute. Même découpe que mobile (`mobile/lib/article-import.ts`), pour que les
 * deux imports nomment un article pareil.
 *
 * Seul le dernier segment tombe : « A - B - C » garde « A - B », un titre sans
 * séparateur reste intact, et un titre qui n'était *que* le nom du site (« | Mon
 * Journal ») n'est pas vidé.
 */
function stripSiteSuffix(title: string) {
  const parts = title.split(/\s+[|–—·-]\s+/)
  return (parts.length > 1 ? parts.slice(0, -1).join(" - ") : title).trim() || title
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}
