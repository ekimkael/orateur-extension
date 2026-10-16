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
// Les mails utilisent aussi des div et des cellules, parfois avec du texte
// directement après un titre : ne pas se limiter aux conteneurs feuilles.
const TEXT_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre,div,section,td,th"

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
  /** Gmail clipped the message: only its beginning is in `textContent`. */
  truncated?: boolean
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

  const text = toSpeakableText(root, lang ?? "")
  return { text: text.length >= MIN_FALLBACK_LENGTH ? text : "", lang }
}

/** Body of each open Gmail message — Gmail drops it when leaving the conversation. */
const GMAIL_BODY = ".a3s"
/** "[Message clipped] View entire message", rendered inside the body. */
const GMAIL_CLIPPED = ".iX"
/**
 * Quoted history Gmail folds behind "…" in a thread: hidden by Gmail's own
 * stylesheet, so the copy would repeat every earlier message in each reply.
 * Also found empty and visible in newsletters; only folded ones are dropped.
 */
const GMAIL_TRIMMED = ".adL"
/**
 * Newsletter preheader: the inbox preview line plus zero-width padding,
 * hidden with an inline style since mail clients drop `<style>`. Read from
 * the clone, it would open every newsletter.
 */
const INLINE_HIDDEN = "[style*='display:none' i],[style*='display: none' i]"

/**
 * Below this share of the whole message, Readability's pick is a fragment of
 * a digest (one Medium card out of ten), not the article inside a newsletter
 * wrapper (ByteByteGo keeps ~40 %, prose newsletters 85 %+).
 */
const MIN_READABLE_SHARE = 0.3

/**
 * The open Gmail message(s), without the app around them.
 *
 * Readability run on the whole Gmail page scores the app too: on a digest of
 * short cards (Medium) a single teaser won. It now runs on the message alone,
 * which still strips newsletter wrappers ("Read in app", "Upgrade to paid");
 * when it keeps too little, or fails, the message is read whole. See
 * docs/gmail-newsletter-extraction.md.
 *
 * The message is copied with `importNode`, never through an HTML string: Gmail
 * enforces Trusted Types, which reject string sinks.
 *
 * `lang` is Gmail's UI language, not the message's: only a prior, which the
 * reader overrides when the text clearly says otherwise (`resolveDocLang`).
 *
 * ponytail: Gmail's obfuscated class names, stable for years; the selectors
 * above are the only thing to update if Gmail renames them. The share
 * threshold is a heuristic; per-sender rules if a newsletter falls on the
 * wrong side.
 *
 * @throws {Error} when no message is open (inbox, search results).
 */
export function extractGmailMessage(
  doc: Document,
  url = doc.location?.href ?? ""
): ExtractedArticle {
  const bodies = doc.querySelectorAll(GMAIL_BODY)
  if (bodies.length === 0) throw new Error(NOT_AN_ARTICLE)

  const message = doc.implementation.createHTMLDocument("")
  for (const body of bodies) message.body.append(message.importNode(body, true))
  // Live layout decides, before the copy loses it: history the reader
  // unfolded with "…" stays. Same document order on both sides.
  const folded = [...doc.querySelectorAll(`${GMAIL_BODY} ${GMAIL_TRIMMED}`)].map(
    (el) => el.getClientRects().length === 0
  )
  message.querySelectorAll(GMAIL_TRIMMED).forEach((el, i) => folded[i] && el.remove())
  const truncated = message.querySelector(GMAIL_CLIPPED) !== null
  remove(message, `${GMAIL_CLIPPED},${INLINE_HIDDEN}`)
  const title = doc.querySelector("h2.hP")?.textContent?.trim() || null
  const lang = doc.documentElement.lang || null

  const root = message.body.cloneNode(true) as Element
  clean(root)
  const textContent = toSpeakableText(root, "")
  if (!textContent) throw new Error(NOT_AN_ARTICLE)

  try {
    const article = extractArticle(message, url)
    if (article.textContent.length >= textContent.length * MIN_READABLE_SHARE) {
      return { ...article, title, lang, truncated }
    }
  } catch {
    // Not readerable, or Readability hit a Trusted Types sink: read it whole.
  }

  return {
    title,
    byline: null,
    dir: null,
    excerpt: null,
    siteName: hostnameOf(url) || null,
    publishedTime: null,
    lang,
    content: root.innerHTML,
    textContent,
    length: textContent.length,
    url,
    readingTimeMinutes: Math.max(1, Math.round(countWords(textContent) / WORDS_PER_MINUTE)),
    truncated,
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
function toSpeakableText(root: Element, lang: string) {
  const notice = CODE_NOTICE_BY_LANGUAGE[lang.slice(0, 2)] ?? CODE_NOTICE
  const collected: Array<{ el: Element; text: string }> = []
  let buffer = ""
  let owner = root

  function flush() {
    const text = normalize(buffer)
    if (text) collected.push({ el: owner, text })
    buffer = ""
  }

  // Lire les nœuds dans l'ordre, sans aplatir un conteneur avant ses enfants.
  // Un li/blockquote peut contenir titre, prose et code ; chacun garde sa
  // frontière, ainsi que le texte libre placé entre deux éléments.
  function collect(node: Node, parent: Element) {
    if (node.nodeType === 3) {
      owner = parent
      buffer += node.textContent ?? ""
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (el.tagName === "BR") {
      flush()
      return
    }
    const block = el.matches(TEXT_BLOCKS)
    if (block) flush()
    if (el.tagName === "PRE") {
      if (el.textContent?.trim()) collected.push({ el, text: notice })
      return
    }
    for (const child of el.childNodes) collect(child, block ? el : parent)
    if (block) flush()
  }

  for (const child of root.childNodes) collect(child, root)
  flush()

  const blocks = collected
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
