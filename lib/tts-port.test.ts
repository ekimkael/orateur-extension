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
  second.send({ type: messages.TTS_SET_SPEED, speed: 1_000 })
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

/** Capture each host lifetime so obsolete callbacks can be exercised explicitly. */
function multiEngineServer() {
  const order: string[] = []
  const hosts: { engine: string; requests: any[]; emit: (state: TtsState) => void }[] = []
  const factory = (engine: string) => (emit: (state: TtsState) => void) => {
    const requests: any[] = []
    hosts.push({ engine, requests, emit })
    return {
      speak: (request: unknown) => { order.push(`${engine}:speak`); requests.push(request) },
      control: (action: string) => {
        order.push(`${engine}:${action}`)
        if (action === "stop") emit({ phase: "ended" })
      },
      seek: () => {},
      setSpeed: () => {},
      dispose: () => { order.push(`${engine}:dispose`) },
    }
  }
  const tts = createTtsServer(factory("supertonic"), factory("pocket"))
  const open = (id: number) => {
    const end = port(id)
    tts.connect(end)
    return end
  }
  return { tts, hosts, order, open }
}

const pocketSpeak = (token = "pocket") => ({
  type: messages.TTS_SPEAK, engine: "pocket", text: "One. Two.", lang: "en", voice: "alba", speed: 1, token,
})

test("engine handoff stops the previous host before starting the next and rejects its late events", async () => {
  const h = multiEngineServer()
  const first = h.open(12)
  const next = h.open(13)
  first.send(speak("first"))
  const oldHost = h.hosts[0]!
  const pending = oldHost.requests[0].prepareParagraph(1)
  next.send(pocketSpeak())
  await assert.rejects(pending, /Page disconnected/)
  assert.deepEqual(h.order, ["supertonic:speak", "supertonic:stop", "supertonic:dispose", "pocket:speak"])

  oldHost.emit({ phase: "error", message: "Late failure" })
  oldHost.emit({ phase: "playing", block: 1, total: 2 })
  h.hosts[1]!.emit({ phase: "playing", block: 0, total: 2 })
  assert.deepEqual(next.posted, [{ type: messages.TTS_EVENT, state: { phase: "playing", block: 0, total: 2 } }])

  next.send(speak("back", false))
  oldHost.emit({ phase: "ended" })
  h.hosts[1]!.emit({ phase: "ended" })
  h.hosts[2]!.emit({ phase: "paused" })
  assert.deepEqual(next.posted.at(-1), { type: messages.TTS_EVENT, state: { phase: "paused" } })
  assert.equal(h.hosts.length, 3, "Returning to a motor gets a fresh host callback identity")
})

test("same-engine readings reuse the host without an extra stop", () => {
  const h = multiEngineServer()
  h.open(12).send(speak("first", false))
  h.open(13).send({ ...speak("second", false), engine: "supertonic" })
  assert.equal(h.hosts.length, 1)
  assert.deepEqual(h.order, ["supertonic:speak", "supertonic:speak"])
})

test("invalid engine requests cannot silence the current owner", () => {
  const h = multiEngineServer()
  const active = h.open(12)
  const intruder = h.open(13)
  active.send(speak("first", false))
  for (const invalid of [
    { ...pocketSpeak(), engine: "unknown" },
    { ...pocketSpeak(), text: { bad: true } },
    { ...pocketSpeak(), speed: Number.NaN },
    { ...pocketSpeak(), startBlock: -1 },
    { ...pocketSpeak(), voice: "F1" },
    { ...pocketSpeak(), lang: "de" },
    { ...pocketSpeak(), cacheOnly: "true" },
    { ...speak(), voice: "unknown" },
    { ...speak(), lang: "unknown" },
  ]) intruder.send(invalid)
  h.hosts[0]!.emit({ phase: "paused" })
  assert.deepEqual(h.order, ["supertonic:speak"])
  assert.deepEqual(active.posted, [{ type: messages.TTS_EVENT, state: { phase: "paused" } }])
})

test("Pocket receives no pronunciation rules and only its current port may control it", () => {
  const h = multiEngineServer()
  const first = h.open(12)
  const next = h.open(13)
  first.send(speak("first", false))
  next.send({ ...pocketSpeak(), cacheOnly: true, personalRules: [{ written: "One", spoken: "Different" }] })
  assert.equal("personalRules" in h.hosts[1]!.requests[0], false)
  assert.equal(h.hosts[1]!.requests[0].cacheOnly, true, "A private reading's cache policy reaches Pocket")
  first.send({ type: messages.TTS_CONTROL, action: "stop" })
  next.send({ type: messages.TTS_CONTROL, action: "pause" })
  assert.equal(h.order.at(-1), "pocket:pause")
  assert.equal(h.order.includes("pocket:stop"), false)
})
