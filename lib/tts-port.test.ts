import assert from "node:assert/strict"
import test from "node:test"
import type { SpeakRequest, TtsHost } from "./tts-host.ts"
import { createTtsServer } from "./tts-port.ts"
import * as messages from "./tts-messages.ts"
import type { TtsState } from "./tts-messages.ts"

/** One end of a reading port, as the host sees it. */
function port(tabId?: number, name = messages.TTS_PORT) {
  const posted: any[] = []
  const onMessage: ((message: unknown) => void)[] = []
  const onDisconnect: (() => void)[] = []
  return {
    name,
    sender: tabId == null ? {} : { tab: { id: tabId } },
    posted,
    postMessage: (message: unknown) => posted.push(structuredClone(message)),
    onMessage: { addListener: (listener: (message: unknown) => void) => onMessage.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => onDisconnect.push(listener) },
    send: (message: unknown) => onMessage.forEach((listener) => listener(message)),
    close: () => onDisconnect.forEach((listener) => listener()),
  }
}

/** Exercise the real ownership rules without a model, an audio device or a browser. */
function server() {
  const requests: SpeakRequest[] = []
  const calls: unknown[][] = []
  let emit!: (state: TtsState) => void
  const tts = createTtsServer((onState) => {
    emit = onState
    return {
      speak: (request) => { requests.push(request) },
      control: (action) => { calls.push(["control", action]) },
      seek: (block, paused) => { calls.push(["seek", block, paused]) },
      setSpeed: (speed) => { calls.push(["speed", speed]) },
    } satisfies TtsHost
  })
  const open = (tabId?: number, name?: string) => {
    const end = port(tabId, name)
    tts.connect(end)
    return end
  }
  return { tts, requests, calls, open, emit: (state: TtsState) => emit(state) }
}

const speak = (token = "owner", livePage = true): messages.TtsSpeakMessage =>
  ({ type: messages.TTS_SPEAK, text: "Un. Deux.", lang: "fr", voice: "F1", speed: 1, token, livePage })

test("only reading ports from a tab can start a reading", () => {
  const h = server()
  h.open(undefined).send(speak())
  h.open(12, "another-port").send(speak())
  const tab = h.open(12)
  tab.send({ ...speak(), token: "" })
  assert.equal(h.requests.length, 0, "A live reading without a token is refused")
  tab.send(speak())
  assert.equal(h.requests.length, 1)
})

test("live paragraphs are requested over the owner's port and matched by id", async () => {
  const h = server()
  const tab = h.open(12)
  const intruder = h.open(13)
  tab.send(speak())
  const prepared = { text: "Le texte actuel de la page.", lang: "fr" }

  const passive = h.requests[0]!.prepareParagraph!(2, true)
  assert.deepEqual(tab.posted, [{ type: messages.TTS_PREPARE_BLOCK, id: 1, block: 2, prefetch: true }])
  intruder.send({ type: messages.TTS_PREPARED, id: 1, prepared: { text: "Forged", lang: "en" } })
  tab.send({ type: messages.TTS_PREPARED, id: 1, prepared })
  assert.deepEqual(await passive, prepared)

  const active = h.requests[0]!.prepareParagraph!(4)
  assert.deepEqual(tab.posted.at(-1), { type: messages.TTS_PREPARE_BLOCK, id: 2, block: 4, prefetch: false })
  tab.send({ type: messages.TTS_PREPARED, id: 2, prepared: null })
  assert.equal(await active, null, "Nothing to read is passed on, never stale text")

  tab.send({ ...speak(), livePage: undefined })
  assert.equal(h.requests[1]!.prepareParagraph, undefined, "Selections and previews keep their supplied text")
})

test("a new reading takes the floor from the previous tab", async () => {
  const h = server()
  const first = h.open(12)
  const second = h.open(13)
  first.send(speak("first"))
  const pending = h.requests[0]!.prepareParagraph!(1)
  second.send(speak("second"))
  await assert.rejects(pending, /Page disconnected/, "An old reading's request cannot read the next owner's tab")
  await assert.rejects(h.requests[0]!.prepareParagraph!(2), /Page disconnected/)

  first.send({ type: messages.TTS_CONTROL, action: "stop" })
  first.send({ type: messages.TTS_SEEK, block: 1, paused: false })
  assert.deepEqual(h.calls, [], "The previous tab cannot drive the new reading")
  second.send({ type: messages.TTS_CONTROL, action: "pause" })
  second.send({ type: messages.TTS_SEEK, block: 2, paused: true })
  second.send({ type: messages.TTS_SET_SPEED, speed: 1.2 })
  second.send({ type: messages.TTS_SEEK, block: -1, paused: true })
  assert.deepEqual(h.calls, [["control", "pause"], ["seek", 2, true], ["speed", 1.2]])
})

test("events reach the owner until the reading ends", () => {
  const h = server()
  const tab = h.open(12)
  tab.send(speak())
  h.emit({ phase: "playing", block: 0, total: 2 })
  h.emit({ phase: "ended" })
  h.emit({ phase: "paused" })
  assert.deepEqual(tab.posted, [
    { type: messages.TTS_EVENT, state: { phase: "playing", block: 0, total: 2 } },
    { type: messages.TTS_EVENT, state: { phase: "ended" } },
  ])
  tab.close()
  assert.deepEqual(h.calls, [], "Closing a finished reading's port stops nothing")
})

test("closing the owner's port stops its reading; another port closing does not", () => {
  const h = server()
  const reader = h.open(12)
  const idle = h.open(13)
  reader.send(speak())
  idle.close()
  assert.deepEqual(h.calls, [])
  reader.close()
  assert.deepEqual(h.calls, [["control", "stop"]])
})

test("another tab's token or the owner's closed tab stops the reading", () => {
  const h = server()
  h.open(12).send(speak("owner"))
  h.tts.tokenChanged("owner")
  h.tts.tabRemoved(13)
  assert.deepEqual(h.calls, [], "Our own token and unrelated tabs change nothing")
  h.tts.tabRemoved(12)
  assert.deepEqual(h.calls, [["control", "stop"]])

  h.open(14).send(speak("owner"))
  h.tts.tokenChanged("someone-else")
  assert.deepEqual(h.calls.at(-1), ["control", "stop"])
})
