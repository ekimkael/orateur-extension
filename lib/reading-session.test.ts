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
const ARTICLE = { text: `${EN}\n\n${EN}\n\n${EN}`, title: "Rainy cat", lang: "en", outro: true }
const EN_THANKS = "End of the article, thank you for listening."
const EN_SUPPORT = "Orateur is built by one person. If this reading was useful, a small donation helps me keep going. The link is right there."
const COMPLETED = "orateur:completed-articles"

/** Speaks utterance `i` from start to end. */
const finish = (i: number) => {
  spoken[i].dispatchEvent(new Event("start"))
  spoken[i].dispatchEvent(new Event("end"))
}
/** Lets the outro's storage round trip settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve))

function session({ resume = false } = {}) {
  spoken = []
  stored = {}
  sent = []
  speech.paused = speech.cancelled = 0
  const states: [ReaderViewState, string | undefined][] = []
  const positions: [number, number][] = []
  const shown: number[] = []
  const support = { shown: 0, available: true }
  const prefs = { engine: "system", voiceURI: null, speed: 1, follow: true } as unknown as ReaderPreferences
  const reader = createReadingSession({
    token: "tab-a",
    prefs: () => prefs,
    view: {
      setState: (state, title) => states.push([state, title]),
      setPosition: (block, total) => positions.push([block, total]),
      attach() {},
      settled: async () => {},
      showSupport: () => {
        if (!support.available) return false
        support.shown++
        return true
      },
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
  return { reader, prefs, states, positions, shown, support, events }
}

test("a system reading follows each paragraph to the end, then folds", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  assert.equal(s.reader.reading, true)
  assert.equal(stored[READER_TOKEN], "tab-a", "Starting takes the floor from other tabs")
  assert.deepEqual(s.states.at(-1), ["playing", "Rainy cat"])

  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  // The outro is not a paragraph of the page: nothing moves while it plays.
  assert.equal(spoken[3].text, `${EN_THANKS} ${EN_SUPPORT}`, "The first completed article asks for support")
  assert.equal(s.reader.reading, true)
  assert.equal(s.support.shown, 1)
  assert.deepEqual(s.positions, [[0, 3], [0, 3], [1, 3], [2, 3]])
  assert.deepEqual(s.shown, [0, 1, 2])

  finish(3)
  assert.equal(s.reader.reading, false)
  assert.deepEqual(s.states.at(-1), ["idle", undefined])
  assert.deepEqual(s.events(), ["read_started", "read_completed", "support_prompt_shown"])
  assert.equal(stored[COMPLETED], 1)
})

test("between cadence points the outro only thanks the listener", async () => {
  const s = session()
  stored[COMPLETED] = 1
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  assert.equal(spoken[3].text, EN_THANKS)
  assert.equal(s.support.shown, 0)
  finish(3)
  assert.deepEqual(s.events(), ["read_started", "read_completed"])
  assert.equal(stored[COMPLETED], 2)
})

test("a reading without outro, like a selection, folds at its end", async () => {
  const s = session()
  await s.reader.start({ ...ARTICLE, outro: undefined })
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  assert.equal(spoken.length, 3)
  assert.deepEqual(s.states.at(-1), ["idle", undefined])
  assert.equal(COMPLETED in stored, false)
})

test("a stopped article gets no outro, even while the counter is read", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  finish(0)
  s.reader.stop()
  await flush()
  assert.equal(spoken.some((utterance) => utterance.text.startsWith(EN_THANKS)), false)
  assert.equal(COMPLETED in stored, false)

  const t = session()
  await t.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  t.reader.stop()
  await flush()
  assert.equal(spoken.length, 3, "Stop during the counter round trip cancels the outro")
  assert.equal(t.support.shown, 0)
})

test("a reading in another language shows the support link without a spoken outro", async () => {
  const s = session()
  const ES = "El gato está sentado en la alfombra y mira la ventana con atención, mientras la lluvia cae suavemente sobre los tejados de toda la ciudad."
  await s.reader.start({ text: `${ES}\n\n${ES}\n\n${ES}`, title: "Gato", lang: "es", outro: true })
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  assert.equal(spoken.length, 3)
  assert.equal(s.support.shown, 1)
  assert.equal(s.reader.reading, false)
  assert.equal(stored[COMPLETED], 1)
})

test("a reading that never made a sound gets no outro", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) spoken[utterance].dispatchEvent(new Event("error"))
  await flush()
  assert.equal(spoken.some((utterance) => utterance.text.startsWith(EN_THANKS)), false)
  assert.equal(s.support.shown, 0)
  assert.equal(COMPLETED in stored, false)
  assert.deepEqual(s.states.at(-1), ["idle", undefined])
})

test("pause and navigation while the outro is prepared do not leak into it", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  const positions = s.positions.length
  s.reader.navigate(-1)
  await s.reader.toggle()
  await flush()
  assert.equal(s.positions.length, positions, "No seek back into the finished article")
  assert.equal(spoken.at(-1)!.text, `${EN_THANKS} ${EN_SUPPORT}`)
  assert.deepEqual(s.states.at(-1), ["playing", "Rainy cat"], "The outro plays, so the pill does too")
  await s.reader.toggle()
  assert.deepEqual(s.states.at(-1), ["paused", undefined], "One press pauses the outro")
})

test("a reading started during the outro is not folded by the outro's end", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  const next = s.reader.start(ARTICLE)
  finish(3)
  await next
  assert.equal(s.reader.reading, true)
  assert.deepEqual(s.states.at(-1), ["playing", "Rainy cat"])
})

test("the system outro is tagged with the language it is written in", async () => {
  const s = session()
  stored[COMPLETED] = 1
  await s.reader.start({ ...ARTICLE, lang: "es" })
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  assert.equal(spoken[3].text, EN_THANKS)
  assert.match(spoken[3].lang, /^en/)
})

test("a support toast the pill cannot show is not counted", async () => {
  const s = session()
  s.support.available = false
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  finish(3)
  assert.deepEqual(s.events(), ["read_started", "read_completed"])
})

test("leaving the page while the outro is prepared leaves no outro mode behind", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  s.reader.pageHidden()
  await flush()
  assert.equal(s.support.shown, 0)
  const positions = s.positions.length
  s.reader.navigate(-1)
  assert.equal(s.positions.length, positions + 1, "Navigation answers again")
})

test("during the outro, pause works and navigation is ignored", async () => {
  const s = session()
  await s.reader.start(ARTICLE)
  for (const utterance of [0, 1, 2]) finish(utterance)
  await flush()
  await s.reader.toggle()
  assert.deepEqual(s.states.at(-1), ["paused", undefined])
  assert.equal(speech.paused, 1)
  await s.reader.toggle()
  assert.deepEqual(s.states.at(-1), ["playing", undefined])
  const positions = s.positions.length
  s.reader.navigate(1)
  s.reader.navigate(-1)
  assert.equal(s.positions.length, positions)
  assert.deepEqual(s.shown, [0, 1, 2])
  assert.equal(spoken.length, 4, "No seek inside the outro")
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

test("a post asks for no spoken intro but keeps its label", async () => {
  const s = session()
  await s.reader.start({ ...ARTICLE, announceTitle: false })
  assert.deepEqual(s.states.at(-1), ["playing", "Rainy cat"])
  assert.equal(spoken[0].text, EN)
})
