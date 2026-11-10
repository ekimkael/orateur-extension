import assert from "node:assert/strict"
import test from "node:test"
import type { PlayerEvent } from "./player.ts"
import type { ReaderPreferences } from "./reader-prefs"
import { createSystemPlayer } from "./system-player.ts"

const english = { voiceURI: "english", lang: "en-US" }
const french = { voiceURI: "french", lang: "fr-CA" }
type Voice = typeof english

class Utterance extends EventTarget {
  text: string
  lang = ""
  rate = 1
  voice: Voice | null = null
  constructor(text: string) {
    super()
    this.text = text
  }
}

let spoken: Utterance[] = []
;(globalThis as any).SpeechSynthesisUtterance = Utterance
;(globalThis as any).speechSynthesis = {
  getVoices: () => [english, french],
  speak: (utterance: Utterance) => spoken.push(utterance),
  pause() {},
  resume() {},
  cancel() {},
}

const FR = "Le chat est assis sur le tapis et regarde la fenêtre avec attention, pendant que la pluie tombe doucement sur les toits de la ville entière."
const EN = "The cat is sitting on the mat and watching the window with attention, while the rain falls gently on the roofs of the whole city outside."

function deferredText() {
  let resolve!: (text: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** A live page whose paragraphs arrive when the test says so. */
function livePage() {
  const pending: ReturnType<typeof deferredText>[] = []
  const prepared: [number, boolean][] = []
  const prefetched: number[] = []
  return {
    pending, prepared, prefetched,
    prepare(index: number, follow: boolean, prefetch = false) {
      if (prefetch) {
        prefetched.push(index)
        return Promise.resolve(EN)
      }
      prepared.push([index, follow])
      const next = deferredText()
      pending.push(next)
      return next.promise
    },
  }
}

function read(paragraphs: string[], { lang, voiceURI = english.voiceURI as string | null, source = null as ReturnType<typeof livePage> | null, startBlock = 0 } = {}) {
  spoken = []
  const events: PlayerEvent[] = []
  const prefs = { voiceURI, speed: 1, follow: true } as ReaderPreferences
  const player = createSystemPlayer({
    paragraphs, text: paragraphs.join("\n\n"), title: "", lang, startBlock, personalRules: [],
    source: source as any, prefs: () => prefs, emit: (event) => events.push(event),
  })
  player.start()
  return { player, events, prefs }
}

/** Lets `play()` go past the awaited live paragraph. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

test("translated French text does not force a saved English voice", () => {
  read([FR], { lang: "fr" })
  assert.equal(spoken[0].lang, "fr")
  assert.equal(spoken[0].voice, null)
})

test("a matching regional voice remains selected", () => {
  read([FR], { lang: "fr", voiceURI: french.voiceURI })
  assert.equal(spoken[0].voice, french)
  read([EN], { lang: "en-GB" })
  assert.equal(spoken[0].voice, english)
})

test("unknown text language retains the selected voice", () => {
  for (const lang of [undefined, "na"]) {
    read(["Current page text."], { lang })
    assert.equal(spoken[0].lang, "", String(lang))
    assert.equal(spoken[0].voice, english, String(lang))
  }
})

test("an unavailable saved voice leaves the browser's choice", () => {
  read([FR], { lang: "fr", voiceURI: "removed-voice" })
  assert.equal(spoken[0].voice, null)
})

test("voice compatibility is checked for each paragraph", () => {
  read([EN, FR], { lang: "en" })
  assert.equal(spoken[0].voice, english)
  spoken[0].dispatchEvent(new Event("end"))
  assert.equal(spoken[1].lang, "fr")
  assert.equal(spoken[1].voice, null)
})

test("every paragraph reports its position, then the end of the reading", () => {
  const { events } = read([EN, EN], { lang: "en" })
  spoken[0].dispatchEvent(new Event("start"))
  spoken[0].dispatchEvent(new Event("error"))
  spoken[1].dispatchEvent(new Event("start"))
  spoken[1].dispatchEvent(new Event("end"))
  assert.deepEqual(events, [
    { phase: "playing", block: 0, total: 2 },
    { phase: "error", reason: "synthesis", recoverable: true },
    { phase: "playing", block: 1, total: 2 },
    { phase: "ended" },
  ])
})

test("a start racing a pause does not report playing", () => {
  const { player, events } = read([EN], { lang: "en" })
  player.pause()
  spoken[0].dispatchEvent(new Event("start"))
  assert.deepEqual(events, [])
})

test("native playback waits for live French text and resets an obsolete English offset", async () => {
  const source = livePage()
  const { player, prefs } = read([EN, EN], { lang: "en", source })
  assert.deepEqual(spoken, [], "An untranslated snapshot must not enter the speech queue")
  source.pending[0].resolve(EN)
  await settle()
  const boundary = Object.assign(new Event("boundary"), { charIndex: 17 })
  spoken[0].dispatchEvent(new Event("start"))
  spoken[0].dispatchEvent(boundary)

  // A new speed restarts from the current word, unless the text changed.
  const previous = { ...prefs }
  prefs.speed = 1.2
  player.update(previous)
  assert.deepEqual(source.prepared, [[0, true], [0, true]])
  source.pending[1].resolve(FR)
  await settle()
  assert.equal(spoken.length, 2)
  assert.equal(spoken[1].text, FR)
  assert.equal(spoken[1].lang, "fr")
  assert.equal(spoken[1].voice, null)
  assert.equal(spoken[1].rate, 1.2)
})

test("native playback prepares the next translation while the current paragraph is speaking", async () => {
  const source = livePage()
  read([EN, EN], { lang: "en", source })
  source.pending[0].resolve(FR)
  await settle()
  spoken[0].dispatchEvent(new Event("start"))
  assert.deepEqual(source.prefetched, [1])
  assert.equal(spoken.length, 1, "Preparation must not queue overlapping speech")
})

test("pausing during live preparation keeps the pending paragraph as the resume target", async () => {
  const source = livePage()
  const { player, events } = read([EN, EN], { lang: "en", source, startBlock: 1 })
  player.pause()
  source.pending[0].resolve(FR)
  await settle()
  assert.deepEqual(spoken, [])
  assert.deepEqual(events, [])

  player.resume()
  assert.deepEqual(source.prepared, [[1, true], [1, true]])
  source.pending[1].resolve(FR)
  await settle()
  assert.equal(spoken.length, 1)
  assert.equal(spoken[0].text, FR, "Resuming uses the prepared paragraph")
  assert.equal(spoken[0].lang, "fr")
})

test("a disposed or stopped player cannot queue delayed live text", async () => {
  for (const end of ["dispose", "stop"] as const) {
    const source = livePage()
    const { player, events } = read([EN, EN], { lang: "en", source })
    player[end]()
    source.pending[0].resolve(FR)
    await settle()
    assert.deepEqual(spoken, [], end)
    assert.deepEqual(events, [], end)
  }
})

test("failed live preparation reports an error instead of reading the English snapshot", async () => {
  const source = livePage()
  const { events } = read([EN, EN], { lang: "en", source })
  source.pending[0].reject(new Error("Translation source unavailable"))
  await settle()
  assert.deepEqual(spoken, [])
  assert.deepEqual(events, [{ phase: "error", reason: "preparation" }])
})

test("a preparation failure after dispose reports nothing", async () => {
  const source = livePage()
  const { player, events } = read([EN, EN], { lang: "en", source })
  player.dispose()
  source.pending[0].reject(new Error("Reading stopped"))
  await settle()
  assert.deepEqual(events, [])
})
