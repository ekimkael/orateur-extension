import assert from "node:assert/strict"
import test from "node:test"
import { expandText } from "./index.ts"
import {
  MAX_RULES, MAX_SOURCE_LENGTH, MAX_REPLACEMENT_LENGTH,
  sanitizePronunciationRules, splitPronunciationSegments, validatePronunciationRule,
  type PronunciationRule,
} from "./personal.ts"

const rule = (source: string, replacement: string, patch: Partial<PronunciationRule> = {}): PronunciationRule => ({
  id: source, language: "fr", source, replacement, caseSensitive: false, ...patch,
})
const apply = (text: string, rules: PronunciationRule[], language = "fr") =>
  splitPronunciationSegments(text, language, rules).map((segment) => segment.text).join("")

test("normalizes rule fields to NFC and trims only exterior spaces", () => {
  const result = validatePronunciationRule(rule("  cafe\u0301  ", "  café  parlé  ", { id: " café " }))
  assert.deepEqual(result, { ok: true, rule: rule("café", "café  parlé", { id: "café" }) })
})

test("validates unknown data, nonempty fields, controls and code point limits", () => {
  for (const input of [null, [], 3, {}, { ...rule("x", "y"), id: "" }, { ...rule("x", "y"), caseSensitive: "false" }]) {
    assert.equal(validatePronunciationRule(input).ok, false)
  }
  assert.deepEqual(validatePronunciationRule(rule(" ", "y", { id: "blank" })), { ok: false, field: "source", code: "required" })
  assert.deepEqual(validatePronunciationRule(rule("x", " ")), { ok: false, field: "replacement", code: "required" })
  assert.deepEqual(validatePronunciationRule({ ...rule("x", "y"), language: "de" }), { ok: false, field: "language", code: "invalid" })
  for (const control of ["\n", "\t", "\0", "\u200b", "\u202e"]) {
    assert.deepEqual(validatePronunciationRule(rule(`x${control}`, "y", { id: "control" })), { ok: false, field: "source", code: "control" })
    assert.deepEqual(validatePronunciationRule(rule("x", `${control}y`)), { ok: false, field: "replacement", code: "control" })
  }
  assert.equal(validatePronunciationRule(rule("😀".repeat(MAX_SOURCE_LENGTH), "😀".repeat(MAX_REPLACEMENT_LENGTH), { id: "emoji" })).ok, true)
  assert.deepEqual(validatePronunciationRule(rule("x".repeat(MAX_SOURCE_LENGTH + 1), "y", { id: "long" })), { ok: false, field: "source", code: "too-long" })
  assert.deepEqual(validatePronunciationRule(rule("x", "y".repeat(MAX_REPLACEMENT_LENGTH + 1))), { ok: false, field: "replacement", code: "too-long" })
})

test("duplicates depend on language, case mode and normalized source; editing excludes own id", () => {
  const current = [rule("café", "first"), rule("API", "api", { id: "api" })]
  assert.deepEqual(validatePronunciationRule(rule("CAFE\u0301", "second", { id: "other" }), current), { ok: false, field: "source", code: "duplicate" })
  assert.equal(validatePronunciationRule(rule("café", "changed"), current).ok, true)
  assert.equal(validatePronunciationRule(rule("café", "english", { id: "en", language: "en" }), current).ok, true)
  assert.equal(validatePronunciationRule(rule("café", "strict", { id: "strict", caseSensitive: true }), current).ok, true)
  assert.equal(validatePronunciationRule(rule("api", "strict", { id: "strict", caseSensitive: true }), [rule("API", "upper", { caseSensitive: true })]).ok, true)
  assert.deepEqual(validatePronunciationRule(rule("ſ", "long s", { id: "s2" }), [rule("s", "s")]), { ok: false, field: "source", code: "duplicate" })
})

test("caps rules while allowing edits and discards corrupt or duplicate storage entries", () => {
  const full = Array.from({ length: MAX_RULES }, (_, i) => rule(`word${i}`, `spoken${i}`))
  assert.deepEqual(validatePronunciationRule(rule("new", "new"), full), { ok: false, field: "form", code: "limit" })
  assert.equal(validatePronunciationRule({ ...full[0]!, replacement: "edited" }, full).ok, true)
  assert.deepEqual(sanitizePronunciationRules("wrong"), [])
  assert.deepEqual(sanitizePronunciationRules([null, rule("API", "first"), rule("API", "second", { id: "duplicate" }), rule("different", "same id", { id: "API" })]), [rule("API", "first")])
  assert.equal(sanitizePronunciationRules([...full, rule("extra", "extra")]).length, MAX_RULES)
})

test("whole Unicode words reject suffixes, plurals, letters, digits, marks and underscores", () => {
  const rules = [rule("API", "interface")]
  assert.equal(apply("API APIs API2 xAPI API_ APIé API\u0338 API漢 漢API API𐐀", rules), "interface APIs API2 xAPI API_ APIé API\u0338 API漢 漢API API𐐀")
  assert.equal(apply("l'API API’API (API), API-API", rules), "l'interface interface’interface (interface), interface-interface")
  assert.equal(apply("\udc00API", rules), "\udc00interface")
})

test("matches NFC equivalents but keeps accents distinct and confines language", () => {
  const rules = [rule("café", "boisson"), rule("API", "fr"), rule("API", "en", { id: "en", language: "en" })]
  assert.equal(apply("cafe\u0301 cafe CAFÉ", rules), "boisson cafe boisson")
  assert.equal(apply("API", rules, "en-US"), "en")
  assert.equal(apply("API", rules, "de"), "API")
})

test("treats regex punctuation and replacement dollar expressions literally", () => {
  assert.equal(apply("a.b axb C++ C+", [rule("a.b", "$&$1"), rule("C++", "langage")]), "$&$1 axb langage C+")
})

test("longest expression wins, strict case wins ties, and input order cannot change result", () => {
  const rules = [rule("Open", "court"), rule("Open AI", "long"), rule("api", "général"), rule("Api", "strict", { caseSensitive: true })]
  const text = "Open AI OPEN Api API api"
  assert.equal(apply(text, rules), "long court strict général général")
  assert.equal(apply(text, [...rules].reverse()), apply(text, rules))
  assert.equal(apply("open AI", [rule("Open AI", "strict", { caseSensitive: true }), rule("Open", "court")]), "court AI")
})

test("generated replacements are protected from other personal rules and builtins in both engines", () => {
  const personalRules = [rule("bug", "API"), rule("API", "NASA"), rule("NASA", "gone")]
  for (const skipPhonetic of [false, true]) {
    assert.equal(expandText("un bug, API et NASA !", { language: "fr", personalRules, skipPhonetic }), "un API, NASA et gone !")
    assert.equal(expandText("bug : fin", { language: "fr", personalRules, skipPhonetic }), "API, fin")
  }
  assert.equal(expandText("bug et frontend", { language: "fr", personalRules }), "API et frontènde")
  assert.equal(expandText("bug et frontend", { language: "fr", personalRules, skipPhonetic: true }), "API et frontend")
  assert.equal(expandText("bug", { language: "en", personalRules }), "bug")
})

test("preserves segment joins around replacements and normalizes final whitespace once", () => {
  const personalRules = [rule("API", "alpha  beta")]
  assert.equal(expandText("  l'API-API, une API !  ", { personalRules }), "l'alpha beta-alpha beta, une alpha beta !")
})

test("personal numeric sources match before normalization and numeric replacements stay protected", () => {
  const personalRules = [rule("40 000", "quelques milliers"), rule("montant", "40 000")]
  for (const skipPhonetic of [false, true]) {
    assert.equal(expandText("40 000 et montant", { language: "fr", personalRules, skipPhonetic }), "quelques milliers et 40 000")
  }
})
