import assert from "node:assert/strict"
import test from "node:test"
import { choosePdfVoice, createPdfSystemPlayer, localPdfVoices, pdfSpeechUnits } from "./pdf-player.ts"
import type { TtsState } from "./tts-messages.ts"
import type { PronunciationRule } from "./pronunciation/personal.ts"

const local = { voiceURI: "local-fr", lang: "fr-FR", localService: true } as SpeechSynthesisVoice
const remote = { voiceURI: "remote-fr", lang: "fr-FR", localService: false } as SpeechSynthesisVoice

class Utterance extends EventTarget {
  text: string
  voice: SpeechSynthesisVoice | null = null
  rate = 1
  constructor(text: string) { super(); this.text = text }
  emit(type: string, charIndex?: number) {
    const event = new Event(type)
    if (charIndex !== undefined) Object.defineProperty(event, "charIndex", { value: charIndex })
    this.dispatchEvent(event)
  }
}

function harness(voices = [remote, local]) {
  const said: Utterance[] = []
  const states: TtsState[] = []
  let cancellations = 0
  const synthesis = {
    getVoices: () => voices,
    speak: (utterance: Utterance) => { said.push(utterance); utterance.emit("start") },
    cancel: () => { cancellations++ }, pause() {}, resume() {},
  }
  const player = createPdfSystemPlayer((state) => states.push(state), synthesis as unknown as SpeechSynthesis, Utterance as unknown as typeof SpeechSynthesisUtterance)
  const request = { paragraphs: ["Premier paragraphe.", "Second paragraphe."], voiceURI: remote.voiceURI, lang: "fr", speed: 1 }
  return { player, states, said, request, cancellations: () => cancellations }
}

test("PDF system reading applies rules before chunking, isolates paragraph languages and keeps display text unchanged", () => {
  const h = harness()
  const paragraphs = [
    "Le chat est assis sur le tapis et regarde la fenêtre pendant que la pluie tombe sur les toits de toute la ville. API : 40 000.",
    "The cat is sitting on the mat and watching the window while the rain falls gently on the roofs of the whole city. API: 40,000.",
  ]
  const original = [...paragraphs]
  const personalRules: PronunciationRule[] = [
    { id: "fr", language: "fr", source: "API", replacement: "interface française", caseSensitive: false },
    { id: "en", language: "en", source: "API", replacement: "English interface", caseSensitive: false },
  ]
  h.player.speak({ ...h.request, paragraphs, personalRules })
  for (let i = 0; i < h.said.length; i++) h.said[i]!.emit("end")
  const spoken = h.said.map((utterance) => utterance.text).join(" ")
  assert.match(spoken, /interface française, 40000/)
  assert.match(spoken, /English interface, 40000/)
  assert.deepEqual(paragraphs, original)
  assert.deepEqual(h.states.filter((state) => state.phase === "playing").map((state) => state.block), [0, 1])
})

test("never selects the default or a saved remote voice", () => {
  assert.deepEqual(localPdfVoices([remote, local]), [local])
  assert.equal(choosePdfVoice([remote, local], remote.voiceURI, "fr"), local)
  assert.equal(choosePdfVoice([remote], remote.voiceURI, "fr"), undefined)
  const h = harness([remote])
  h.player.speak(h.request)
  assert.equal(h.said.length, 0)
  assert.deepEqual(h.states.at(-1), { phase: "error", message: "no-local-voice" })
})

test("reads every paragraph in order and ends after the last utterance", () => {
  const h = harness()
  h.player.speak(h.request)
  assert.equal(h.said[0]!.voice, local)
  h.said[0]!.emit("end")
  h.said[1]!.emit("end")
  assert.deepEqual(h.said.map((u) => u.text), h.request.paragraphs)
  assert.deepEqual(h.states.filter((s) => s.phase === "playing").map((s) => s.block), [0, 1])
  assert.deepEqual(h.states.at(-1), { phase: "ended" })
})

test("chunks long paragraphs and hard breaks without dropping content or splitting surrogate pairs", () => {
  const text = "Une longue phrase. ".repeat(100)
  const units = pdfSpeechUnits([text, "あ".repeat(380), "😀".repeat(200)])
  assert.ok(units.every((unit) => unit.text.length <= 180))
  assert.equal(units.filter((unit) => unit.block === 0).map((unit) => unit.text).join(" "), text.trim())
  assert.equal(units.filter((unit) => unit.block === 1).map((unit) => unit.text).join(""), "あ".repeat(380))
  assert.equal(units.filter((unit) => unit.block === 2).map((unit) => unit.text).join(""), "😀".repeat(200))
  assert.ok(units.every((unit) => unit.text.isWellFormed()))
})

test("pause at an utterance boundary waits for resume before the next paragraph", () => {
  const h = harness()
  h.player.speak(h.request)
  h.player.control("pause")
  h.said[0]!.emit("end")
  assert.equal(h.said.length, 1)
  h.player.control("resume")
  assert.equal(h.said[1]!.text, h.request.paragraphs[1])
})

test("stop and replacement invalidate late speech events", () => {
  const h = harness()
  h.player.speak(h.request)
  const old = h.said[0]!
  h.player.stop()
  old.emit("end")
  old.emit("error")
  assert.equal(h.said.length, 1)
  h.player.speak({ ...h.request, paragraphs: ["Une nouvelle lecture."] })
  old.emit("end")
  assert.equal(h.said.length, 2)
  assert.equal(h.said[1]!.text, "Une nouvelle lecture.")
})

test("speed changes resume from a word boundary and respect pause", () => {
  const h = harness()
  h.player.speak(h.request)
  h.said[0]!.emit("boundary", 8)
  h.player.control("pause")
  h.player.setSpeed(1.3)
  assert.equal(h.said.length, 1)
  h.player.control("resume")
  assert.equal(h.said[1]!.text, "paragraphe.")
  assert.equal(h.said[1]!.rate, 1.3)
})
