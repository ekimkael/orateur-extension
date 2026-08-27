/**
 * Détection de langue d'un bloc de texte, pour corriger ce qu'un attribut
 * `lang` de page dit de travers ou ne dit pas — voir `toSupertonicLang` dans
 * `supertonic-lang.ts`, qui résout la déclaration mais ne regarde jamais le
 * texte lui-même.
 *
 * Deux étages, du plus fiable au plus fin :
 *
 *  1. Script dominant (comptage par plage Unicode). Un script propre à une
 *     langue tranche seul (grec, hangul, kana, arabe, devanagari) ; un script
 *     partagé (latin, cyrillique) ne fait que restreindre les candidats.
 *  2. Score par mots-outils sur les candidats restants — seules les langues
 *     latines/cyrilliques qui se croisent réellement dans la nature ont une
 *     table : suffisant pour corriger un article anglais sur un site français,
 *     pas pour départager le finnois de l'estonien.
 *
 * Le repli (`fallback`) est la règle, pas l'exception : sous le plancher de
 * tokens, de score, ou de marge avec le second, mieux vaut garder la langue
 * déjà connue (celle du document, ou `null` faute de mieux) que de deviner sur
 * un texte trop court pour trancher. C'est ce qui empêche un titre de deux mots
 * ou une légende de faire papillonner la voix.
 *
 * Aucun import hors `./supertonic-lang.ts` : ce module part dans le bundle du
 * content script, chargé sur toutes les pages (voir l'en-tête de
 * `tts-messages.ts` pour la même règle).
 */
import type { SupportedLang } from "./supertonic-lang.ts"

const MIN_CHARS = 8
const MIN_TOKENS = 12
const MIN_SCORE = 0.12
const MIN_MARGIN = 0.04
/** Sous ce nombre de mots distincts, la table de mots ne prouve plus rien : seule une signature peut trancher. */
const HARD_MIN_TOKENS = 4

/**
 * Score et marge exigés pour un texte de `distinct` mots distincts. Ce qu'un
 * texte court perd en volume de preuve, il doit le rendre en netteté : un titre
 * de quatre mots ne passe que si presque tous sont des mots-outils d'une seule
 * table.
 *
 * ponytail : interpolation linéaire, pas de calibration statistique. Les pentes
 * sont réglées pour qu'à quatre mots il faille ~1 mot-outil exclusif sur 3 ;
 * à recalibrer sur des vrais textes si le repli devient trop (ou pas assez)
 * fréquent.
 */
function floors(distinct: number): { score: number; margin: number } {
  if (distinct >= MIN_TOKENS) return { score: MIN_SCORE, margin: MIN_MARGIN }
  const short = (MIN_TOKENS - distinct) / MIN_TOKENS
  return { score: MIN_SCORE + short * 0.28, margin: MIN_MARGIN + short * 0.16 }
}

/**
 * Signes propres à une seule langue du modèle — dans l'esprit d'`UKRAINIAN_ONLY`
 * plus bas. Assez pour trancher un titre de trois mots que la table de mots
 * laisse indécis.
 *
 * Rien pour `fr`, `it`, `nl`, `en` : leurs diacritiques sont tous partagés avec
 * une autre langue de la liste, une signature y serait un faux ami. Ne pas en
 * inventer.
 */
const SIGNATURES: [SupportedLang, RegExp][] = [
  ["es", /[ñ¿¡]/u],
  ["pt", /[ãõ]/u],
  // ä/ö/ü seuls ne suffisent pas : le finnois et le suédois les partagent, et
  // ne sont eux-mêmes candidats nulle part dans `LATIN_CANDIDATES` — un texte
  // finnois traverserait quand même cette branche. `ß` seul est réellement
  // exclusif à l'allemand.
  ["de", /ß/u],
]

/** L'unique langue signée par le texte, ou `null` si aucune — ou si plusieurs se contredisent. */
function bySignature(text: string): SupportedLang | null {
  const hits = SIGNATURES.filter(([, pattern]) => pattern.test(text))
  return hits.length === 1 ? hits[0]![0] : null
}

/** Mots grammaticaux fréquents, assez pour distinguer un texte de l'autre sans prétendre à l'exhaustivité. */
const WORD_TABLES: Partial<Record<SupportedLang, Set<string>>> = {
  en: new Set([
    "the", "of", "and", "to", "in", "is", "was", "that", "for", "on", "with",
    "as", "it", "at", "by", "an", "be", "this", "from", "or", "are", "but",
    "not", "have", "has", "had", "which", "you", "they", "we", "were", "will",
  ]),
  fr: new Set([
    "le", "la", "les", "de", "des", "et", "un", "une", "est", "dans", "que",
    "qui", "pour", "sur", "avec", "au", "aux", "ce", "cette", "il", "elle",
    "nous", "vous", "ils", "elles", "pas", "plus", "mais", "ou", "du", "en",
  ]),
  es: new Set([
    "el", "la", "los", "las", "de", "y", "en", "que", "un", "una", "es",
    "para", "con", "por", "del", "al", "se", "su", "no", "más", "pero", "o",
    "como", "este", "esta", "son", "muy", "lo", "le", "les",
  ]),
  de: new Set([
    "der", "die", "das", "und", "ist", "in", "den", "von", "zu", "mit", "auf",
    "für", "ein", "eine", "nicht", "sich", "dem", "des", "im", "sie", "wir",
    "ihr", "aber", "oder", "wie", "auch", "sind", "war", "einen",
  ]),
  it: new Set([
    "il", "lo", "la", "di", "e", "che", "un", "una", "è", "per", "in", "con",
    "del", "della", "non", "si", "come", "questo", "questa", "sono", "ma",
    "o", "più", "anche", "loro", "suo", "sua", "gli", "le",
  ]),
  pt: new Set([
    "o", "a", "de", "e", "que", "um", "uma", "é", "para", "em", "com", "do",
    "da", "não", "se", "como", "este", "esta", "são", "mas", "ou", "mais",
    "também", "seu", "sua", "os", "as", "no", "na",
  ]),
  nl: new Set([
    "de", "het", "een", "en", "van", "is", "in", "dat", "op", "met", "voor",
    "niet", "zijn", "aan", "deze", "die", "wij", "ze", "maar", "of", "meer",
    "ook", "hun", "wat", "hoe", "was", "er",
  ]),
  ru: new Set([
    "и", "в", "не", "на", "что", "я", "с", "он", "как", "а", "то", "все",
    "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за", "бы",
    "по", "только", "этот", "было",
  ]),
  uk: new Set([
    "і", "й", "в", "не", "на", "що", "я", "з", "він", "як", "а", "то", "все",
    "вона", "так", "його", "але", "ти", "до", "у", "ж", "ви", "за", "би",
    "по", "тільки", "цей", "було", "є", "ї", "ґ",
  ]),
  bg: new Set([
    "и", "в", "не", "на", "че", "аз", "с", "той", "като", "а", "то", "всичко",
    "тя", "така", "но", "да", "ти", "до", "у", "също", "вие", "за", "би",
    "по", "само", "този", "беше", "със", "от",
  ]),
}

/** Lettres exclusives à l'ukrainien dans l'alphabet cyrillique — tranchent sans passer par le score. */
const UKRAINIAN_ONLY = /[їєґі]/

/** Kana (hiragana + katakana) : signature du japonais même noyé dans du kanji. */
const KANA = /[぀-ヿ]/gu

interface ScriptRange {
  lang: SupportedLang | "cyrillic" | "latin" | "han"
  pattern: RegExp
}

// Ordre sans effet : chaque plage est comptée indépendamment.
const SCRIPTS: ScriptRange[] = [
  { lang: "el", pattern: /[Ͱ-Ͽ]/gu },
  { lang: "ko", pattern: /[가-힣ᄀ-ᇿ]/gu },
  { lang: "hi", pattern: /[ऀ-ॿ]/gu },
  { lang: "ar", pattern: /[؀-ۿ]/gu },
  { lang: "cyrillic", pattern: /[Ѐ-ӿ]/gu },
  { lang: "han", pattern: /[一-鿿]/gu },
  { lang: "latin", pattern: /[A-Za-zÀ-ɏ]/gu },
]

function dominantScript(text: string): ScriptRange["lang"] | null {
  // Le japonais mélange kanji (script `han`, partagé avec le chinois) et kana :
  // c'est la présence de kana, pas un décompte de majorité, qui le trahit —
  // un texte japonais réel est souvent majoritairement kanji.
  if ((text.match(KANA)?.length ?? 0) >= 2) return "ja"

  let best: ScriptRange["lang"] | null = null
  let bestCount = 0
  let total = 0
  const counts = SCRIPTS.map((s) => {
    const count = text.match(s.pattern)?.length ?? 0
    total += count
    return { lang: s.lang, count }
  })
  for (const c of counts) {
    if (c.count > bestCount) {
      bestCount = c.count
      best = c.lang
    }
  }
  // Un script qui ne domine pas franchement (texte très mélangé, ou trop peu
  // de lettres pour trancher) ne vaut pas d'être suivi.
  if (total === 0 || bestCount / total < 0.6) return null
  return best
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+/gu) ?? []
}

const LATIN_CANDIDATES: SupportedLang[] = ["en", "fr", "es", "de", "it", "pt", "nl"]
const CYRILLIC_CANDIDATES: SupportedLang[] = ["ru", "uk", "bg"]

/**
 * Poids IDF par mot, au sein d'un groupe de candidats : un mot présent dans
 * une seule table du groupe compte pour 1, un mot partagé par toutes compte
 * pour presque rien. Sans ça, le fonds commun slave (« и », « в », « а »...)
 * fait gagner n'importe quelle table par accident — c'est ce qui confondait
 * russe et bulgare avant.
 */
function buildWeights(candidates: SupportedLang[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const lang of candidates) {
    for (const word of WORD_TABLES[lang] ?? []) df.set(word, (df.get(word) ?? 0) + 1)
  }
  const weights = new Map<string, number>()
  for (const [word, count] of df) weights.set(word, 1 / count)
  return weights
}

const LATIN_WEIGHTS = buildWeights(LATIN_CANDIDATES)
const CYRILLIC_WEIGHTS = buildWeights(CYRILLIC_CANDIDATES)

/** Score `tokens` contre chaque table candidate, ou `null` sous les planchers de score/marge. */
function bestByWordTable(
  tokens: string[],
  candidates: SupportedLang[],
  weights: Map<string, number>
): SupportedLang | null {
  // Dédoublonné : un mot répété dix fois ne doit pas peser plus qu'une fois,
  // sinon un seul faux ami répété fait gagner sa table (vu sur le finnois,
  // où « on » — mot outil anglais — revenait trois fois dans une phrase).
  const distinct = [...new Set(tokens)]
  if (distinct.length < HARD_MIN_TOKENS) return null
  const scored = candidates
    .map((lang) => {
      const table = WORD_TABLES[lang]
      if (!table) return null
      const weight = distinct.reduce((sum, t) => sum + (table.has(t) ? (weights.get(t) ?? 1) : 0), 0)
      return { lang, score: weight / distinct.length }
    })
    .filter((s): s is { lang: SupportedLang; score: number } => s !== null)
    .sort((a, b) => b.score - a.score)

  const { score: minScore, margin: minMargin } = floors(distinct.length)
  const top = scored[0]
  if (!top || top.score < minScore) return null
  const second = scored[1]
  if (second && top.score - second.score < minMargin) return null
  return top.lang
}

/**
 * Langue détectée du texte, ou `fallback` faute de verdict assez sûr.
 * `fallback` peut être `null` (aucune idée a priori du côté appelant).
 */
export function detectLang(text: string, fallback: SupportedLang | null): SupportedLang | null {
  // Un texte trop court n'a de toute façon rien à donner à `dominantScript`.
  if (text.trim().length < MIN_CHARS) return fallback

  const script = dominantScript(text)
  switch (script) {
    // Le script suffit seul : aucune des cinq n'a de voisine avec laquelle la
    // confondre dans `AVAILABLE_LANGS`, et le japonais/coréen ne séparent pas
    // leurs mots par des espaces — `tokenize` n'en tirerait presque rien.
    case "el":
    case "ko":
    case "ja":
    case "hi":
    case "ar":
      return script
    case "han":
      // Chinois hors modèle (voir AVAILABLE_LANGS) : aucun verdict possible.
      return fallback
    case "cyrillic": {
      if (UKRAINIAN_ONLY.test(text)) return "uk"
      const tokens = tokenize(text)
      // Pas de table de signatures côté cyrillique (§ ci-dessus) : la table de
      // mots dit tout ce qu'il y a à dire.
      return bestByWordTable(tokens, CYRILLIC_CANDIDATES, CYRILLIC_WEIGHTS) ?? fallback
    }
    case "latin": {
      const tokens = tokenize(text)
      const byTable = bestByWordTable(tokens, LATIN_CANDIDATES, LATIN_WEIGHTS)
      const bySign = bySignature(text)
      // Un verdict par table qu'une signature contredit est plus suspect que
      // les deux pris isolément — sur un texte aussi court, mieux vaut douter.
      if (byTable && bySign && byTable !== bySign) return fallback
      return byTable ?? bySign ?? fallback
    }
    default:
      return fallback
  }
}

// Réexporté pour les tests uniquement, pour vérifier la couverture des tables
// sans les lister à la main.
export const _WORD_TABLE_LANGS = Object.keys(WORD_TABLES) as SupportedLang[]
