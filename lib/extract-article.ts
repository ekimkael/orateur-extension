import { isProbablyReaderable, Readability } from "@mozilla/readability"
// Extension explicite : `node --test` résout les modules sans elle, contrairement
// à Vite. Même raison que l'import de `pronunciation/index.ts` dans le lecteur.
import { withStop } from "./reading-intro.ts"
import { speakTable } from "./speak-table.ts"
import { countWords, hostnameOf, normalize, remove } from "./extract/dom.ts"
import { siteCleanup } from "./extract/sites.ts"

/** Aligné sur mobile/lib/article-import.ts pour que les durées concordent. */
export const WORDS_PER_MINUTE = 200

/** The error every extractor throws for a page with nothing to read. */
export const NOT_AN_ARTICLE = "Cette page ne contient pas d'article lisible."

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
 * Said instead of a code block.
 *
 * Reading code aloud means speaking its punctuation, indentation and
 * identifiers: the web app says nothing (`sequence-builder.ts`,
 * `case "code": return []`) and mobile does not collect it. Full silence would
 * cut a tutorial without saying so, hence the notice.
 *
 * "Below" holds because the notice is only spoken over the page: the reading
 * follower cannot find this text in the `<pre>` (lib/read-anchor.ts), so the
 * previous paragraph stays highlighted, right above the code. The Orateur
 * handoff sends Readability's HTML (`content`), never this spoken text.
 *
 * Same convention as `reading-intro`: two-letter language code, French by
 * default (French is the fallback, not an entry of the table).
 */
const CODE_NOTICE = "Vous pouvez avoir un aperçu en regardant le code ci-dessous."
const CODE_NOTICE_BY_LANGUAGE: Record<string, string> = {
  en: "You can get an overview by looking at the code below.",
  es: "Puede hacerse una idea mirando el código de abajo.",
  de: "Einen Überblick gibt Ihnen der Code unten.",
  it: "Può farsi un'idea guardando il codice qui sotto.",
  pt: "Pode ter uma ideia olhando para o código abaixo.",
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
  /**
   * `false` when the title must not be spoken before the text (an X post:
   * its "title" is its own first line). It still labels the pill and the
   * saved item.
   */
  announceTitle?: false
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
  const completeBody = prepareEditorialContent(clone, url, doc)?.cloneNode(true) as Element | undefined
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

  const root = completeBody ?? parsed?.content
  if (!root || !parsed) throw new Error(NOT_AN_ARTICLE)

  const lang = parsed.lang || doc.documentElement.lang || null

  clean(root)
  if (completeBody) {
    // Readability normally resolves these on its selected fragment. Curated
    // bodies must keep source links valid when imported into another page too.
    for (const link of root.querySelectorAll("a[href]")) {
      try {
        const target = new URL(link.getAttribute("href")!, doc.baseURI || url)
        if (/^(https?|mailto|tel|sms):$/.test(target.protocol)) link.setAttribute("href", target.href)
        else link.removeAttribute("href")
      } catch {
        link.removeAttribute("href")
      }
    }
  }
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
  const completeBody = prepareEditorialContent(clone, doc.location?.href ?? "", doc)
  remove(clone, INERT_SELECTORS)
  removeNoise(clone)
  desarmHeadings(clone)

  const root = completeBody ?? clone.body
  const lang = doc.documentElement.lang || null
  if (!root) return { text: "", lang }
  if (completeBody) clean(root)

  const text = toSpeakableText(root, lang ?? "")
  return { text: text.length >= MIN_FALLBACK_LENGTH ? text : "", lang }
}

/** CMS structures verified on live articles; only the copy is changed. */
function prepareEditorialContent(doc: Document, url: string, original: Document): Element | null {
  // Full-page access errors contain prose that Readability or the visible-text
  // fallback would otherwise read as an article.
  const cloudfrontError = doc.title === "ERROR: The request could not be satisfied" &&
    doc.querySelector("body > pre")?.textContent?.startsWith("Generated by cloudfront")
  const bloombergChallenge = doc.title === "Bloomberg - Are you a robot?" && doc.querySelector("#px-captcha")
  if (doc.querySelector("#cf-error-details,#challenge-error-text") || cloudfrontError || bloombergChallenge) {
    doc.body?.replaceChildren()
    return null
  }
  const host = hostnameOf(url).replace(/^www\./, "")
  const { lead = null, body = null, caption = null, completeBody = null } = siteCleanup(host)?.(doc, original, host) ?? {}

  // These CMSs place the visible introduction outside the scored article.
  if (caption && body && !body.contains(caption)) body.prepend(caption)
  if (lead && body && !lead.contains(body) && !body.contains(lead)) body.prepend(lead)
  // These educational pages are curated bodies of sections and references.
  // Keep their complete corpus; Readability still supplies the metadata.
  return completeBody
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

/** Drops inert and noisy elements, presentation attributes and empty blocks from an extracted root. */
export function clean(root: Element) {
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
export function toSpeakableText(root: Element, lang: string, { pruneResidue = true } = {}) {
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
    // Layout tables come back null and keep the cell-by-cell walk below.
    const table = el.tagName === "TABLE" ? speakTable(el as HTMLTableElement, lang) : null
    if (table) {
      flush()
      for (const text of table) collected.push({ el, text })
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
    // Code, output, code is the norm in a tutorial: without this merge the voice
    // says the notice three times in a row. Same for back-to-back large tables.
    // Rows of a table read aloud differ from each other and are all kept; two
    // notices split by a paragraph are both said.
    .filter(({ el, text }, index, all) => {
      const previous = all[index - 1]
      return !/^(PRE|TABLE)$/.test(el.tagName) || previous?.el.tagName !== el.tagName || previous.text !== text
    })

  // Ponctuation en dernier : titres, items de liste et légendes ne finissent
  // jamais par un point dans le HTML, et la voix enchaîne alors sur le bloc
  // suivant comme si la phrase continuait. Après le rognage, lui, qui reconnaît
  // les étiquettes de fin d'article *à* leur absence de ponctuation.
  const text = (pruneResidue ? pruneTrailingResidue(blocks) : blocks)
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

