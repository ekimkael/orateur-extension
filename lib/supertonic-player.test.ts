import assert from "node:assert/strict"
import test from "node:test"
import type { PlayerEvent } from "./player.ts"
import type { ReaderPreferences } from "./reader-prefs"
import { createSupertonicPlayer } from "./supertonic-player.ts"
import {
  TTS_CONTROL,
  TTS_EVENT,
  TTS_OPEN,
  TTS_PORT,
  TTS_PREPARE_BLOCK,
  TTS_PREPARED,
  TTS_SEEK,
  TTS_SET_SPEED,
  TTS_SPEAK,
  type TtsState,
} from "./tts-messages.ts"


/** The tab's end of the reading port. */
function port(name: string) {
  const posted: any[] = []
  const onMessage: ((message: unknown) => void)[] = []
  const onDisconnect: (() => void)[] = []
  return {
    name, posted, disconnected: false,
    postMessage(message: unknown) { posted.push(structuredClone(message)) },
    disconnect() { this.disconnected = true },
    onMessage: { addListener: (listener: (message: unknown) => void) => onMessage.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => onDisconnect.push(listener) },
    send: (message: unknown) => onMessage.forEach((listener) => listener(message)),
    close: () => onDisconnect.forEach((listener) => listener()),
  }
}

const sent: any[] = []
let hostReady = true
let opened: ReturnType<typeof port> | null = null
;(globalThis as any).browser = {
  runtime: {
    sendMessage: async (message: any) => {
      sent.push(message)
      return message.type === TTS_OPEN ? hostReady : undefined
    },
    connect: ({ name }: { name: string }) => (opened = port(name)),
  },
  i18n: { getMessage: (key: string) => `[${key}]` },
}
;(globalThis as any).document = { documentElement: { lang: "en" } }

const EN = "The cat is sitting on the mat and watching the window with attention, while the rain falls gently on the roofs of the whole city outside."
/** Lets the open handshake and queued commands go through. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

async function read({ source = null as { prepare: (...args: any[]) => Promise<string> } | null, ready = true, paragraphs = [EN, EN, EN], beforeOpen = (_player: ReturnType<typeof createSupertonicPlayer>) => {} } = {}) {
  sent.length = 0
  hostReady = ready
  opened = null
  const events: PlayerEvent[] = []
  const prefs = { speed: 1, follow: true, supertonicVoice: "F1" } as ReaderPreferences
  const player = createSupertonicPlayer({
    paragraphs, text: paragraphs.join("\n\n"), title: "", lang: "en", startBlock: 1, personalRules: [],
    source: source as any, token: "tab-token", prefs: () => prefs, emit: (event) => events.push(event),
  })
  player.start()
  beforeOpen(player)
  await settle()
  const host = (state: TtsState) => opened!.send({ type: TTS_EVENT, state })
  return { player, events, prefs, host, port: opened }
}

const kinds = () => sent.map((message) => message.event?.name ?? message.type)

test("a reading opens the host, then speaks over its own port", async () => {
  const { port } = await read()
  assert.deepEqual(kinds(), [TTS_OPEN])
  assert.equal(port!.name, TTS_PORT)
  assert.equal(port!.posted[0].type, TTS_SPEAK)
  assert.equal(port!.posted[0].token, "tab-token")
  assert.equal(port!.posted[0].startBlock, 1)
})

test("commands given before the port opens follow the start, in order", async () => {
  const { port } = await read({ beforeOpen: (player) => { player.pause(); player.seek(0) } })
  assert.deepEqual(port!.posted.map((message) => message.type), [TTS_SPEAK, TTS_CONTROL, TTS_SEEK])
  assert.deepEqual(port!.posted.at(-1), { type: TTS_SEEK, block: 0, paused: true }, "A seek while paused stays paused")
})

test("an unavailable host fails the start with a readable message", async () => {
  const { events, port } = await read({ ready: false })
  assert.equal(port, null, "No port is opened to a missing host")
  assert.deepEqual(events.at(-1), { phase: "error", reason: "preparation", message: "[errorSupertonicStartFailed]" })
})

test("host events become player events, with download telemetry only for a real download", async () => {
  const { events, host } = await read()
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

test("only a speed change reaches the host while reading", async () => {
  const { player, prefs, port } = await read()
  const previous = { ...prefs }
  prefs.supertonicVoice = "M1" as ReaderPreferences["supertonicVoice"]
  player.update(previous)
  prefs.speed = 1.3
  player.update(previous)
  await settle()
  assert.deepEqual(port!.posted.slice(1), [{ type: TTS_SET_SPEED, speed: 1.3 }])
})

test("disposing closes the port and ignores the host; a vanished host fails the reading", async () => {
  const done = await read()
  done.player.dispose()
  assert.equal(done.port!.disconnected, true, "Closing the port is what releases the host")
  done.host({ phase: "ended" })
  assert.deepEqual(done.events, [{ phase: "loading" }])

  const orphan = await read()
  orphan.port!.close()
  assert.deepEqual(orphan.events.at(-1), { phase: "error", reason: "preparation" })
})

test("live block requests answer by id and prepare the page as the host asks", async () => {
  const calls: unknown[][] = []
  const { port } = await read({ source: { prepare: async (...args) => { calls.push(structuredClone(args)); return "Le texte actuel." } } })
  const ask = async (request: object) => {
    port!.send({ type: TTS_PREPARE_BLOCK, ...request })
    await settle()
    return port!.posted.at(-1)
  }
  await ask({ id: 1, block: 2, prefetch: true })
  await ask({ id: 2, block: 2, prefetch: false })
  assert.equal((await ask({ id: 3, block: 1, prefetch: false })).id, 3)
  assert.deepEqual(calls, [[2, true, true, "nearest"], [2, true, false, "nearest"], [1, true, false, "center"]],
    "Passive requests stay passive; active forward blocks align to the viewport")
  assert.deepEqual(await ask({ id: 4, block: 2, prefetch: "true" }), { type: TTS_PREPARED, id: 4, prepared: null })
  assert.deepEqual(await ask({ id: 5, block: 3 }), { type: TTS_PREPARED, id: 5, prepared: null })
  assert.equal(calls.length, 3, "Invalid requests never prepare or scroll the page")
})

test("a re-prepared short block keeps the reading's language, not the page declaration", async () => {
  // Gmail declares its French UI; the message is English. "Read more" alone
  // is too short to decide, so it must inherit what the start resolved.
  ;(globalThis as any).document = { documentElement: { lang: "fr" } }
  const { port } = await read({ source: { prepare: async () => "Read more" } })
  port!.send({ type: TTS_PREPARE_BLOCK, id: 1, block: 2 })
  await settle()
  assert.equal(port!.posted.at(-1).prepared.lang, "en")
  ;(globalThis as any).document = { documentElement: { lang: "en" } }
})
