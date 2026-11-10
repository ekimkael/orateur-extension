export interface PronunciationRule {
  id: string
  language: "fr" | "en"
  source: string
  replacement: string
  caseSensitive: boolean
}

export const MAX_RULES = 200
export const MAX_SOURCE_LENGTH = 100
export const MAX_REPLACEMENT_LENGTH = 200

export type PronunciationValidation =
  | { ok: true; rule: PronunciationRule }
  | {
      ok: false
      field: "source" | "replacement" | "language" | "form"
      code: "required" | "too-long" | "control" | "duplicate" | "limit" | "invalid"
    }

const CONTROL = /[\p{Cc}\p{Cf}]/u
const WORD_END = /[\p{L}\p{N}\p{M}_]$/u
const WORD_START = /^[\p{L}\p{N}\p{M}_]/u
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function validatePronunciationRule(
  input: unknown,
  existing: readonly PronunciationRule[] = [],
): PronunciationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, field: "form", code: "invalid" }
  }
  const candidate = input as Record<string, unknown>
  if (candidate.language !== "fr" && candidate.language !== "en") {
    return { ok: false, field: "language", code: "invalid" }
  }
  if (typeof candidate.id !== "string" || !candidate.id.trim()
    || Array.from(candidate.id).length > 100 || CONTROL.test(candidate.id)
    || typeof candidate.caseSensitive !== "boolean") {
    return { ok: false, field: "form", code: "invalid" }
  }
  const fields: Partial<Record<"source" | "replacement", string>> = {}
  for (const [field, max] of [["source", MAX_SOURCE_LENGTH], ["replacement", MAX_REPLACEMENT_LENGTH]] as const) {
    const value = candidate[field]
    if (typeof value !== "string") return { ok: false, field, code: "invalid" }
    if (CONTROL.test(value)) return { ok: false, field, code: "control" }
    const normalized = value.normalize("NFC").trim()
    if (!normalized) return { ok: false, field, code: "required" }
    if (Array.from(normalized).length > max) return { ok: false, field, code: "too-long" }
    fields[field] = normalized
  }
  const rule: PronunciationRule = {
    id: candidate.id.normalize("NFC").trim(),
    language: candidate.language,
    source: fields.source!,
    replacement: fields.replacement!,
    caseSensitive: candidate.caseSensitive,
  }
  const sameSource = new RegExp(`^${escapePattern(rule.source)}$`, rule.caseSensitive ? "u" : "iu")
  if (existing.some((entry) => entry.id !== rule.id && entry.language === rule.language
    && entry.caseSensitive === rule.caseSensitive && sameSource.test(entry.source))) {
    return { ok: false, field: "source", code: "duplicate" }
  }
  if (existing.length >= MAX_RULES && !existing.some((entry) => entry.id === rule.id)) {
    return { ok: false, field: "form", code: "limit" }
  }
  return { ok: true, rule }
}

export function sanitizePronunciationRules(input: unknown): PronunciationRule[] {
  if (!Array.isArray(input)) return []
  const rules: PronunciationRule[] = []
  const ids = new Set<string>()
  for (const entry of input) {
    const result = validatePronunciationRule(entry, rules)
    if (!result.ok || ids.has(result.rule.id)) continue
    rules.push(result.rule)
    ids.add(result.rule.id)
    if (rules.length === MAX_RULES) break
  }
  return rules
}

export interface PronunciationSegment { text: string; protected: boolean }

/** Match original text once; generated speech never becomes another rule's input. */
export function splitPronunciationSegments(
  raw: string,
  language: string,
  personalRules: readonly PronunciationRule[],
): PronunciationSegment[] {
  const text = raw.normalize("NFC")
  const rules = personalRules.filter((rule) => rule.language === language.slice(0, 2).toLowerCase())
    .sort((a, b) => Array.from(b.source).length - Array.from(a.source).length
      || Number(b.caseSensitive) - Number(a.caseSensitive)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((rule) => ({ rule, pattern: new RegExp(escapePattern(rule.source), rule.caseSensitive ? "uy" : "iuy") }))
  if (!rules.length) return [{ text, protected: false }]
  const scanner = new RegExp(rules.map(({ rule }) => escapePattern(rule.source)).join("|"), "giu")
  const segments: PronunciationSegment[] = []
  let consumed = 0
  let match: RegExpExecArray | null
  while ((match = scanner.exec(text))) {
    const start = match.index
    let chosen: { rule: PronunciationRule; end: number } | undefined
    if (!WORD_END.test(text.slice(Math.max(0, start - 2), start))) {
      for (const { rule, pattern } of rules) {
        pattern.lastIndex = start
        const candidate = pattern.exec(text)
        if (!candidate) continue
        const end = start + candidate[0].length
        if (!WORD_START.test(text.slice(end, end + 2))) { chosen = { rule, end }; break }
      }
    }
    if (!chosen) {
      scanner.lastIndex = start + (text.codePointAt(start)! > 0xffff ? 2 : 1)
      continue
    }
    if (start > consumed) segments.push({ text: text.slice(consumed, start), protected: false })
    segments.push({ text: chosen.rule.replacement, protected: true })
    consumed = scanner.lastIndex = chosen.end
  }
  if (consumed < text.length) segments.push({ text: text.slice(consumed), protected: false })
  return segments
}
