import {
  sanitizePronunciationRules,
  validatePronunciationRule,
  type PronunciationRule,
  type PronunciationValidation,
} from "./pronunciation/personal.ts"

export {
  MAX_RULES, MAX_SOURCE_LENGTH, MAX_REPLACEMENT_LENGTH,
  sanitizePronunciationRules, validatePronunciationRule,
  type PronunciationRule, type PronunciationValidation,
} from "./pronunciation/personal.ts"

const RULES_KEY = "orateur:pronunciation-rules"
let writes: Promise<unknown> = Promise.resolve()

function serialize<T>(write: () => Promise<T>): Promise<T> {
  const result = writes.then(write, write)
  writes = result.catch(() => {})
  return result
}

export async function loadPronunciationRules(): Promise<PronunciationRule[]> {
  const stored = await browser.storage.local.get(RULES_KEY)
  return sanitizePronunciationRules(stored[RULES_KEY])
}

export function upsertPronunciationRule(input: unknown): Promise<PronunciationValidation> {
  return serialize(async () => {
    const current = await loadPronunciationRules()
    const result = validatePronunciationRule(input, current)
    if (!result.ok) return result
    const index = current.findIndex((entry) => entry.id === result.rule.id)
    if (index < 0) current.push(result.rule)
    else current[index] = result.rule
    await browser.storage.local.set({ [RULES_KEY]: current })
    return result
  })
}

export function removePronunciationRule(id: string): Promise<void> {
  return serialize(async () => {
    const current = await loadPronunciationRules()
    await browser.storage.local.set({ [RULES_KEY]: current.filter((entry) => entry.id !== id) })
  })
}

export function onPronunciationRulesChanged(callback: (rules: PronunciationRule[]) => void) {
  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && RULES_KEY in changes) callback(sanitizePronunciationRules(changes[RULES_KEY]?.newValue))
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}
