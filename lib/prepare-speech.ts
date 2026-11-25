import { Verbalizer } from "verbalis"
import { detectLang } from "./detect-lang.ts"
import type { PlayerOptions } from "./player.ts"
import { splitPronunciationSegments, type PronunciationRule } from "./pronunciation/personal.ts"
import { buildReadingIntro } from "./reading-intro.ts"
import { resolveBlockLangs } from "./reading-language.ts"
import { toSupertonicLang } from "./supertonic-lang.ts"

const languages = new Set(Verbalizer.languages())
const verbalizers = new Map<string, Verbalizer>()
const ambiguousEnglishDate = /(?<![\w/])(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|1[0-2])(?:\/(?:\d{4}|\d{2}))?(?![\w/])/g
const keycapEmoji = /[#*0-9]\uFE0F?\u20E3/u
const pictograph = /\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?/u
const displayEmoji = /(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation}(?!\uFE0E))(?:\uFE0F|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*/u
const joinedEmoji = String.raw`${pictograph.source}(?:\u200D${pictograph.source})+`
const emoji = `(?:${keycapEmoji.source}|${joinedEmoji}|${displayEmoji.source})`
const emojiRuns = new RegExp(String.raw`(?<![\t\p{Zs}])([\t\p{Zs}]*)${emoji}(?:[\t\p{Zs}]*${emoji})*`, "gu")
const spokenContent = /[^\s\p{P}]/u
const greekLetterNames: Readonly<Record<string, string>> = { μ: "mu", Ω: "omega", Δ: "delta" }
const standaloneGreekLetter = /(?<![\p{L}\p{N}_.:/@#?&=%+-])(?:[μΔ]|(?<!\d[\t\p{Zs}]+)Ω)(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu

function withoutEmoji(text: string): string {
  return text.replace(emojiRuns, (run, space: string, start: number) => {
    const end = start + run.length
    const next = text.slice(end, end + 2)
    if (/^[.,…\])}]/u.test(next)) return ""
    const previous = text.slice(Math.max(0, start - 2), start)
    return space || (/[\p{L}\p{N}]$/u.test(previous) && /^[\p{L}\p{N}]/u.test(next) ? " " : "")
  })
}

function prepareFrenchForms(text: string, normalize: (text: string) => string): string {
  const readDigits = (digits: string) => normalize([...digits].join(" "))
  // Match standalone forms so a URL, identifier, or spaced scientific unit keeps its meaning.
  // Spell uptime expressions in full so a closing quote cannot turn the last number into inches.
  return text
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])((?:à|dès|vers|il[\t\p{Zs}]+est)[\t\p{Zs}]+|(?:heure|horaire)[\t\p{Zs}]*:[\t\p{Zs}]*)0{1,2}(?:[\t\p{Zs}]*h(?:[\t\p{Zs}]*([0-5]\d))?|:([0-5]\d))(?![\p{L}\p{N}_:/@#?&=%+-]|\.[\p{L}\p{N}]|[\t\p{Zs}]+\d)/giu,
      (written: string, cue: string, hourMinutes: string | undefined, colonMinutes: string | undefined, offset: number, source: string) => {
        // The same cue can introduce a duration, as in "la durée est ramenée à 0 h 30".
        const beforeCue = source.slice(0, offset)
        if (/\b(?:durées?|délais?|autonomies?|chronomètres?|minuteurs?|comptes? à rebours)\b[^.!?;,\n]*$/iu.test(beforeCue)) return written
        const minutes = Number(hourMinutes ?? colonMinutes ?? "0")
        return cue + (minutes ? `minuit ${normalize(String(minutes)).trim()}` : "minuit")
      })
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])24h\/24(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/giu, "vingt-quatre heures sur vingt-quatre")
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])7j\/7(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/giu, "sept jours sur sept")
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])\d+H(?:[0-5]\d)?(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu,
      (hour) => hour.toLowerCase())
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])([vV])(\d+\.\d+\.\d+)(?![\p{L}\p{N}_/@#?&=%]|\.[\p{L}\p{N}])/gu, "$1 $2")
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])((?:OAuth|version)[\t\p{Zs}]+)(\d+(?:\.\d+)+)(?![\p{L}\p{N}_/@#?&=%]|\.[\p{L}\p{N}])/giu,
      (_, label: string, version: string) => label + normalize(version.replaceAll(".", " point ")))
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])([Ss]ection[\t\p{Zs}]+)([IVXLCDM]+)(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu,
      // Verbalis recognizes Roman numerals after "chapitre", including its ambiguity checks.
      (_, label: string, numeral: string) => label + normalize(`chapitre ${numeral}`).slice("chapitre ".length))
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])\+[1-9]\d{0,2}(?:[\t\p{Zs}]+\d{1,4}){2,7}(?![\p{L}\p{N}_/@#?&=%+-]|[.,]\d|\.[\p{L}]|[\t\p{Zs}]+\d)/gu,
      (phone: string, offset: number, source: string) => {
        const [country, ...groups] = phone.slice(1).split(/\s+/)
        const length = (country! + groups.join("")).length
        if (length < 8 || length > 15) return phone
        // All three-digit groups are also used for signed quantities.
        if (groups.every((group) => group.length === 3) &&
            !/\b(?:appelez|appeler|contactez|joindre|téléphone|tél\.)(?:\s+le)?[\s:]*$/iu.test(source.slice(Math.max(0, offset - 40), offset))) return phone
        return `plus ${readDigits(country!)}, ${groups.map((group) => group.length > 2 ? readDigits(group) : normalize(group)).join(", ")}`
      })
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])(ticket[\t\p{Zs}]+)#(\d+)(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/giu,
      (_, label: string, digits: string) => `${label}numéro ${readDigits(digits)}`)
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])((?:statut|état)[\t\p{Zs}]*:[\t\p{Zs}]*)EN_ATTENTE(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/giu, "$1en attente")
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])([+-]?\d+(?:[ \u00a0\u202f]\d{3})*(?:[,.]\d+)?)[\t\p{Zs}]*(mAh|Mb\/s|FCFA)(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu,
      (_, amount: string, unit: string) => {
        const plural = Math.abs(Number(amount.replace(/\s/g, "").replace(",", "."))) >= 2
        if (unit === "FCFA") return `${amount} ${plural ? "francs" : "franc"} CFA`
        const words = unit === "mAh"
          ? (plural ? "milliampères-heures" : "milliampère-heure")
          : (plural ? "mégabits par seconde" : "mégabit par seconde")
        return `${amount} ${words}`
      })
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])FCFA(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu, "franc CFA")
    // Name standalone letters and leave omega after a quantity available as a unit.
    .replace(standaloneGreekLetter, (symbol) => symbol === "Ω" ? "oméga" : greekLetterNames[symbol]!)
}

function prepareEnglishSymbols(text: string): string {
  return text
    .replace(/(?<![\p{L}\p{N}_.,:/@#?&=%+-])([+-]?(?:\d+(?:[, \u00a0\u202f]\d{3})*(?:\.\d+)?|\.\d+))[\t\p{Zs}]*(Ω|[μµ]g)(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu,
      (_, amount: string, symbol: string) => {
        const unit = symbol === "Ω" ? "ohm" : "microgram"
        const singular = Math.abs(Number(amount.replace(/[,\s]/g, ""))) === 1
        return `${amount} ${unit}${singular ? "" : "s"}`
      })
    .replace(/(?<![\p{L}\p{N}_.:/@#?&=%+-])Δ([Tt])(?![\p{L}\p{N}_/@#?&=%+-]|\.[\p{L}\p{N}])/gu, "delta $1")
    .replace(standaloneGreekLetter, (symbol) => greekLetterNames[symbol]!)
}

/** Prepare text for speech, skipping emoji and applying locale-specific normalization where available. */
export function prepareSpeech(text: string, language: string, rules: readonly PronunciationRule[] = []): string {
  const [base, ...subtags] = language.toLowerCase().split(/[-_]/)
  const region = subtags.find((tag) => /^[a-z]{2}$/.test(tag))
  const code = base === "en" && (region === "gb" || region === "us") ? `en-${region}` : base
  if (!code || !languages.has(code)) {
    const plain = withoutEmoji(text)
    return plain === text || spokenContent.test(plain) ? plain : ""
  }
  let verbalizer = verbalizers.get(code)
  if (!verbalizer) {
    // Trimming a segment would delete the spaces around protected replacements.
    verbalizer = new Verbalizer(code, { trim: false, symbolWords: code === "fr" ? { "÷": "divisé par" } : undefined })
    verbalizers.set(code, verbalizer)
  }
  const normalize = (raw: string) => verbalizer.process(raw)
  const segments = splitPronunciationSegments(text, code, rules)
  let removedEmoji = false
  const spoken = segments.map((segment) => {
    const plain = withoutEmoji(segment.text)
    removedEmoji ||= plain !== segment.text
    if (segment.protected) return plain
    if (code === "fr") return normalize(prepareFrenchForms(plain, normalize))
    if (base !== "en") return normalize(plain)
    const raw = prepareEnglishSymbols(plain)
    if (code === "en-us") return normalize(raw)
    let start = 0
    let spoken = ""
    // Verbalis 0.1.1 gives US readings of ambiguous slash dates even in en-gb.
    for (const match of raw.matchAll(ambiguousEnglishDate)) {
      spoken += normalize(raw.slice(start, match.index)) + match[0]
      start = match.index + match[0].length
    }
    return spoken + normalize(raw.slice(start))
  }).join("").replace(/\s+/g, " ").trim()
  // Extraction can add a stop even to a paragraph made entirely of emoji.
  if (removedEmoji && !spokenContent.test(spoken)) return ""
  return spoken || text
}

/** Keep the declared locale when detection agrees or has no confident result. */
export function resolveSpeechLanguage(text: string, declared?: string): string {
  const detected = detectLang(text, null)
  return detected && detected !== toSupertonicLang(declared ?? "") ? detected : declared || "na"
}

/** Prepare one snapshot and reuse its paragraph indices when the live text changes. */
export function createSpeechPreparation(
  { paragraphs, text, title, personalRules, documentLanguage }: Pick<PlayerOptions,
    "paragraphs" | "text" | "title" | "personalRules" | "documentLanguage">,
  fallback?: string,
) {
  const language = resolveSpeechLanguage(text, documentLanguage || fallback)
  const base = toSupertonicLang(language) ?? "na"
  const intro = buildReadingIntro(language, title)
  const prepare = (raw: string, lang: string, index: number) => ({
    text: prepareSpeech(index === 0 && intro ? `${intro} ${raw}` : raw, lang, personalRules),
    lang,
  })
  const initial = resolveBlockLangs(paragraphs, base).map((lang, index) => {
    const raw = paragraphs[index]!
    return { raw, block: prepare(raw, lang === base ? language : lang, index) }
  })
  const current = [...initial]
  return {
    paragraphs: initial.map(({ block }) => block),
    hasSpeech(index: number) {
      return !!current[index]?.block.text
    },
    refresh(index: number, raw: string) {
      const previous = current[index]!
      if (raw === previous.raw) return previous.block
      const block = prepare(raw, resolveSpeechLanguage(raw, previous.block.lang), index)
      current[index] = { raw, block }
      return block
    },
  }
}
