import assert from "node:assert/strict"
import test from "node:test"
import type { PlayerEvent } from "./player.ts"
import type { ReaderPreferences } from "./reader-prefs"
import { createSupertonicPlayer } from "./supertonic-player.ts"
import { TTS_EVENT, TTS_PREPARE_BLOCK, TTS_SEEK, TTS_SET_SPEED, type TtsState } from "./tts-messages.ts"

const sent: any[] = []
;(globalThis as any).browser = {
  runtime: { sendMessage: async (message: unknown) => { sent.push(message) } },
  i18n: { getMessage: (key: string) => `[${key}]` },
}
;(globalThis as any).document = { documentElement: { lang: "en" } }

const EN = "The cat is sitting on the mat and watching the window with attention, while the rain falls gently on the roofs of the whole city outside."

function read(source: { prepare: (...args: any[]) => Promise<string> } | null = null) {
  sent.length = 0
  const events: PlayerEvent[] = []
  const prefs = { speed: 1, follow: true, supertonicVoice: "F1" } as ReaderPreferences
  const player = createSupertonicPlayer({
    paragraphs: [EN, EN], text: `${EN}\n\n${EN}`, title: "", lang: "en", startBlock: 1, personalRules: [],
    source: source as any, token: "tab-token", prefs: () => prefs, emit: (event) => events.push(event),
  })
  player.start()
  const host = (state: TtsState) => player.receive!({ type: TTS_EVENT, state } as any)
  return { player, events, prefs, host }
}

const kinds = () => sent.map((message) => message.event?.name ?? message.action ?? message.type)

test("host events become player events, with download telemetry only for a real download", () => {
  const { events, host } = read()
  host({ phase: "loading", reason: "downloading-model", progress: 10 })
  host({ phase: "loading", reason: "downloading-model", progress: 60 })
  host({ phase: "playing", block: 1, total: 2 })
  host({ phase: "error", message: "boom", reason: "audio-playback" })
  assert.deepEqual(events, [
    { phase: "loading" },
    { phase: "loading", reason: "downloading-model", progress: 10 },
    { phase: "loading", reason: "downloading-model", progress: 60 },
    { phase: "playing", block: 1, total: 2 },
    { phase: "error", reason: "audio_playback", message: "[ttsAudioError]" },
  ])
  assert.deepEqual(kinds().filter((kind) => kind.startsWith("supertonic_")), [
    "supertonic_download_started",
    "supertonic_download_completed",
  ])
})

test("a seek while paused asks the host to stay paused", () => {
  const { player } = read()
  player.pause()
  player.seek(0)
  assert.deepEqual(sent.at(-1), { type: TTS_SEEK, block: 0, paused: true })
})

test("only a speed change reaches the host while reading", () => {
  const { player, prefs } = read()
  const previous = { ...prefs }
  prefs.supertonicVoice = "M1" as ReaderPreferences["supertonicVoice"]
  player.update(previous)
  prefs.speed = 1.3
  player.update(previous)
  assert.deepEqual(sent.slice(1), [{ type: TTS_SET_SPEED, speed: 1.3 }])
})

test("live block requests answer only this reading's token and a valid block", async () => {
  const { player } = read({ prepare: async () => EN })
  assert.equal(await player.receive!({ type: TTS_PREPARE_BLOCK, token: "other", block: 0 } as any), null)
  assert.equal(await player.receive!({ type: TTS_PREPARE_BLOCK, token: "tab-token", block: 2 } as any), null)
  assert.deepEqual(await player.receive!({ type: TTS_PREPARE_BLOCK, token: "tab-token", block: 1 } as any), { text: EN, lang: "en" })
})

test("a disposed player ignores the host", () => {
  const { player, events, host } = read()
  player.dispose()
  host({ phase: "ended" })
  assert.deepEqual(events, [{ phase: "loading" }])
})
