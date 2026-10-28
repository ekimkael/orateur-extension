import assert from "node:assert/strict"
import test from "node:test"
import { READER_TOKEN } from "./reader-messages.ts"
import type { ReaderPreferences } from "./reader-prefs"
import { READING_PROGRESS_KEY } from "./reading-progress.ts"
import { createReadingSession, type ReaderViewState } from "./reading-session.ts"

class Utterance extends EventTarget {
  lang = ""
  rate = 1
  voice = null
  text: string
  constructor(text: string) {
    super()
    this.text = text
  }
}

let spoken: Utterance[] = []
let stored: Record<string, unknown> = {}
let sent: any[] = []
const speech = { paused: 0, cancelled: 0 }
;(globalThis as any).SpeechSynthesisUtterance = Utterance
;(globalThis as any).speechSynthesis = {
  getVoices: () => [],
  speak: (utterance: Utterance) => spoken.push(utterance),
  pause: () => speech.paused++,
  resume() {},
  cancel: () => speech.cancelled++,
}
;(globalThis as any).document = { title: "Article", documentElement: { lang: "en" } }
;(globalThis as any).browser = {
  runtime: { sendMessage: async (message: unknown) => { sent.push(message) } },
  storage: {
    local: {
      get: async (key: string) => (key in stored ? { [key]: stored[key] } : {}),
      set: async (items: Record<string, unknown>) => { Object.assign(stored, items) },
      remove: async (key: string) => { delete stored[key] },
    },
  },
  i18n: { getMessage: (key: string) => key },
  extension: { inIncognitoContext: false },
}

const EN = "The cat is sitting on the mat and watching the window with attention, while the rain falls gently on the roofs of the whole city outside."
const ARTICLE = { text: `${EN}\n\n${EN}\n\n${EN}`, title: "Rainy cat", lang: "en" }

function session({ resume = false } = {}) {
  spoken = []
  stored = {}
  sent = []
  speech.paused = speech.cancelled = 0
  const states: [ReaderViewState, string | undefined][] = []
  const positions: [number, number][] = []
  const shown: number[] = []
  const prefs = { engine: "system", voiceURI: null, speed: 1, follow: true } as unknown as ReaderPreferences
  const reader = createReadingSession({
    token: "tab-a",
    prefs: () => prefs,
    view: {
      setState: (state, title) => states.push([state, title]),
      setPosition: (block, total) => positions.push([block, total]),
      attach() {},
      settled: async () => {},
    },
    follower: { begin() {}, show: (block) => shown.push(block), end() {} },
    page: {
      liveSource: () => { throw new Error("not a live page") },
      url: () => "https://example.test/article",
      contextBlock: () => -1,
      confirmResume: () => resume,
    },
  })
  const events = () => sent.filter((message) => message.event).map((message) => message.event.name)
  return { reader, prefs, states, positions, shown, events }
}

test("a system reading follows each paragraph to the end, then folds", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  assert.equal(s.reader.reading, true)
  assert.equal(stored[READER_TOKEN], "tab-a", "Starting takes the floor from other tabs")
  assert.deepEqual(s.states.at(-1), ["playing", "Rainy cat"])

  for (const utterance of [0, 1, 2]) {
    spoken[utterance].dispatchEvent(new Event("start"))
    spoken[utterance].dispatchEvent(new Event("end"))
  }
  assert.deepEqual(s.positions, [[0, 3], [0, 3], [1, 3], [2, 3]])
  assert.deepEqual(s.shown, [0, 1, 2])
  assert.equal(s.reader.reading, false)
  assert.deepEqual(s.states.at(-1), ["idle", undefined])
  assert.deepEqual(s.events(), ["read_started", "read_completed"])
})

test("pause and resume answer at once and reach the engine", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  await s.reader.toggle()
  assert.deepEqual(s.states.at(-1), ["paused", undefined])
  assert.equal(speech.paused, 1)
  await s.reader.toggle()
  assert.deepEqual(s.states.at(-1), ["playing", undefined])
})

test("navigation stays within the article and saves the target", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  s.reader.navigate(-1)
  assert.deepEqual(s.positions, [[0, 3]], "No paragraph before the first")
  s.reader.navigate(1)
  assert.deepEqual(s.positions.at(-1), [1, 3])
  assert.equal(spoken.at(-1)!.text, EN)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((stored[READING_PROGRESS_KEY] as any)["https://example.test/article"].block, 1)
})

test("saved progress resumes where the reading stopped, or is cleared", async () => {
  for (const resume of [true, false]) {
    const s = session({ resume })
    await s.reader.start(ARTICLE)
    s.reader.navigate(1)
    s.reader.navigate(1)
    s.reader.stop()
    await new Promise((resolve) => setImmediate(resolve))

    const progress = stored[READING_PROGRESS_KEY]
    const again = session({ resume })
    stored[READING_PROGRESS_KEY] = progress
    await again.reader.start(ARTICLE)
    assert.deepEqual(again.positions[0], [resume ? 2 : 0, 3], String(resume))
  }
})

test("another tab taking the floor folds this pill without touching the engine", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  s.reader.storageChanged({ [READER_TOKEN]: { newValue: "tab-a" } })
  assert.equal(s.reader.reading, true, "Our own token changes nothing")
  const cancelled = speech.cancelled
  s.reader.storageChanged({ [READER_TOKEN]: { newValue: "tab-b" } })
  assert.equal(s.reader.reading, false)
  assert.equal(speech.cancelled, cancelled, "The other tab's speech is left alone")
  spoken.at(-1)!.dispatchEvent(new Event("end"))
  assert.equal(spoken.length, 1, "A late end from the folded reading queues nothing")
})

test("changing engine mid-reading stops the running one", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  const previous = { ...s.prefs }
  s.prefs.engine = "supertonic"
  s.reader.prefsChanged(previous)
  assert.equal(s.reader.reading, false)
  assert.ok(speech.cancelled > 0)
})
