import assert from "node:assert/strict"
import test from "node:test"
import {
  loadPronunciationRules, onPronunciationRulesChanged, removePronunciationRule, upsertPronunciationRule,
  type PronunciationRule,
} from "./pronunciation-rules.ts"

const KEY = "orateur:pronunciation-rules"
const rule = (id: string, patch: Partial<PronunciationRule> = {}): PronunciationRule => ({
  id, language: "fr", source: id, replacement: `spoken ${id}`, caseSensitive: false, ...patch,
})

function fakeStorage(initial: unknown = undefined) {
  const data: Record<string, unknown> = { [KEY]: initial }
  const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>()
  let failNextWrite = false
  ;(globalThis as any).browser = {
    storage: {
      local: {
        get: async (key: string) => {
          await Promise.resolve()
          return structuredClone({ [key]: data[key] })
        },
        set: async (entries: Record<string, unknown>) => {
          if (failNextWrite) { failNextWrite = false; throw new Error("storage unavailable") }
          Object.assign(data, structuredClone(entries))
        },
      },
      onChanged: {
        addListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.add(listener),
        removeListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(listener),
      },
    },
  }
  return { data, listeners, failWrite: () => { failNextWrite = true } }
}

test("loads sanitized local data and ignores malformed rows and repeated ids", async () => {
  fakeStorage([null, rule("one"), rule("one", { source: "two" }), rule("three", { language: "xx" as "fr" })])
  assert.deepEqual(await loadPronunciationRules(), [rule("one")])
  fakeStorage({ wrong: true })
  assert.deepEqual(await loadPronunciationRules(), [])
})

test("concurrent writes are serialized and editing preserves other rules", async () => {
  fakeStorage()
  const result = await Promise.all([upsertPronunciationRule(rule("one")), upsertPronunciationRule(rule("two"))])
  assert.equal(result.every((entry) => entry.ok), true)
  await upsertPronunciationRule(rule("one", { replacement: "edited" }))
  assert.deepEqual(await loadPronunciationRules(), [rule("one", { replacement: "edited" }), rule("two")])
  await removePronunciationRule("one")
  assert.deepEqual(await loadPronunciationRules(), [rule("two")])
})

test("invalid writes leave stored rules untouched", async () => {
  const { data } = fakeStorage([rule("one")])
  const result = await upsertPronunciationRule(rule("two", { source: "ONE" }))
  assert.deepEqual(result, { ok: false, field: "source", code: "duplicate" })
  assert.deepEqual(data[KEY], [rule("one")])
})

test("write failure rejects without poisoning subsequent queued writes", async () => {
  const storage = fakeStorage()
  storage.failWrite()
  const first = upsertPronunciationRule(rule("one"))
  const second = upsertPronunciationRule(rule("two"))
  await assert.rejects(first, /storage unavailable/)
  assert.equal((await second).ok, true)
  assert.deepEqual(await loadPronunciationRules(), [rule("two")])
})

test("change listener sanitizes only local changes and unsubscribes", () => {
  const { listeners } = fakeStorage()
  const seen: PronunciationRule[][] = []
  const unsubscribe = onPronunciationRulesChanged((rules) => seen.push(rules))
  const notify = (value: unknown, area: string) => listeners.forEach((listener) => listener({ [KEY]: { newValue: value } }, area))
  notify([rule("one")], "sync")
  notify([null, rule("one")], "local")
  notify(undefined, "local")
  assert.deepEqual(seen, [[rule("one")], []])
  unsubscribe()
  notify([rule("two")], "local")
  assert.equal(seen.length, 2)
  assert.equal(listeners.size, 0)
})
