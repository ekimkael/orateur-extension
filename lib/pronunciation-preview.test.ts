import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { createPronunciationPreview } from "./pronunciation-preview.ts"
import type { PronunciationRule } from "./pronunciation/personal.ts"
import type { ReaderPreferences } from "./reader-prefs.ts"
import type { TtsState } from "./tts-messages.ts"

const rule: PronunciationRule = { id: "test", language: "fr", source: "GitHub", replacement: "plateforme de code", caseSensitive: false }
const prefs: ReaderPreferences = { engine: "system", speed: 1.2, voiceURI: "selected", supertonicVoice: "F1", follow: true, position: "bottom-right" }

class Utterance extends EventTarget {
  text: string
  voice: SpeechSynthesisVoice | null = null
  lang = ""
  rate = 1
  constructor(text: string) { super(); this.text = text }
}

function harness(t: TestContext) {
  const names = ["browser", "speechSynthesis", "SpeechSynthesisUtterance"] as const
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  t.after(() => {
    preview.stop()
    names.forEach((name, index) => {
      const descriptor = originals[index]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
  })
  const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>()
  const data: Record<string, unknown> = {}
  const said: Utterance[] = []
  const states: TtsState[] = []
  let cancellations = 0
  let delayChanges = false
  const queued: Record<string, { newValue?: unknown }>[] = []
  let read: (() => Promise<Record<string, unknown>>) | undefined
  const selected = { voiceURI: "selected", lang: "en-US", localService: true } as SpeechSynthesisVoice
  Object.assign(globalThis, {
    browser: { storage: {
      local: {
        async get() { return read ? read() : { ...data } },
        async set(values: Record<string, unknown>) {
          Object.assign(data, values)
          const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]))
          if (delayChanges) queued.push(changes)
          else listeners.forEach((listener) => listener(changes, "local"))
        },
      },
      onChanged: { addListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.add(listener), removeListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(listener) },
    } },
    speechSynthesis: {
      resume() {}, cancel() { cancellations++ }, getVoices: () => [selected],
      speak(utterance: Utterance) { said.push(utterance); utterance.dispatchEvent(new Event("start")) },
    },
    SpeechSynthesisUtterance: Utterance,
  })
  const preview = createPronunciationPreview((state) => states.push(state))
  return {
    preview, states, said, listeners, selected, cancellations: () => cancellations,
    delayRead: (callback: NonNullable<typeof read>) => { read = callback },
    delayChanges: () => { delayChanges = true },
    flushChanges: () => queued.splice(0).forEach((changes) => listeners.forEach((listener) => listener(changes, "local"))),
  }
}

test("previews an unsaved rule with selected voice and explicit rule language, without rewriting its output", async (t) => {
  const h = harness(t)
  await h.preview.speak(rule, prefs)
  assert.equal(h.said[0]!.text, rule.replacement)
  assert.equal(h.said[0]!.voice, h.selected)
  assert.equal(h.said[0]!.lang, "fr")
  assert.equal(h.said[0]!.rate, prefs.speed)
  assert.equal(h.cancellations(), 1)
  assert.equal(h.states.at(-1)!.phase, "playing")
  h.said[0]!.dispatchEvent(new Event("end"))
  assert.equal(h.states.at(-1)!.phase, "ended")
  assert.equal(h.listeners.size, 0)
})

test("stopping while ownership is being acquired cannot start late audio", async (t) => {
  const h = harness(t)
  let finish!: (value: Record<string, unknown>) => void
  h.delayRead(() => new Promise((resolve) => { finish = resolve }))
  const speaking = h.preview.speak(rule, prefs)
  await Promise.resolve()
  h.preview.stop()
  finish({})
  await speaking
  assert.equal(h.said.length, 0)
  assert.equal(h.listeners.size, 0)
})

test("a new reader takes ownership without the old preview cancelling its audio", async (t) => {
  const h = harness(t)
  await h.preview.speak(rule, prefs)
  const cancellations = h.cancellations()
  h.listeners.forEach((listener) => listener({ "orateur:reading-tab": { newValue: "other-reader" } }, "local"))
  assert.equal(h.cancellations(), cancellations)
  assert.equal(h.states.at(-1)!.phase, "ended")
  assert.equal(h.listeners.size, 0)
  h.said[0]!.dispatchEvent(new Event("error"))
  assert.equal(h.states.at(-1)!.phase, "ended")
})

test("delayed ownership events from a previous preview cannot stop the next preview", async (t) => {
  const h = harness(t)
  h.delayChanges()
  await h.preview.speak(rule, prefs)
  await h.preview.speak({ ...rule, replacement: "nouvel aperçu" }, prefs)
  h.flushChanges()
  assert.equal(h.said.length, 2)
  assert.equal(h.states.at(-1)!.phase, "playing")
  assert.equal(h.listeners.size, 1)
})

test("an unavailable neural model produces an error without downloading or interrupting another reader", async (t) => {
  const h = harness(t)
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected download") })
  await h.preview.speak(rule, { ...prefs, engine: "supertonic" })
  assert.deepEqual(h.states.at(-1), { phase: "error", message: "model-unavailable" })
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(h.cancellations(), 0)
  assert.equal(h.listeners.size, 0)
})
