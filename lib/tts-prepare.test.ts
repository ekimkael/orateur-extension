import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import type { SpeakRequest } from "./tts-host.ts"
import * as messages from "./tts-messages.ts"

type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown

/** Exercise real routing without loading a model, an audio device or a browser. */
function routing(firefox: boolean, offscreen = false) {
  const listeners: Listener[] = []
  const deliveries: { tabId?: number; message: unknown }[] = []
  const requests: SpeakRequest[] = []
  const transport = { fail: false, response: { text: "Le texte actuel de la page.", lang: "fr" } }
  const deliver = async (message: unknown, tabId?: number) => {
    deliveries.push({ tabId, message: structuredClone(message) })
    if (transport.fail) throw new Error("Page disconnected")
    return transport.response
  }
  const event = { addListener() {} }
  const browser = {
    runtime: { id: "orateur-test", onInstalled: event, onMessage: { addListener: (fn: Listener) => listeners.push(fn) }, sendMessage: (message: unknown) => deliver(message) },
    tabs: { onRemoved: event, sendMessage: (tabId: number, message: unknown) => deliver(message, tabId) },
    storage: { onChanged: event }, contextMenus: { onClicked: event }, action: { onClicked: event },
  }
  const source = readFileSync(new URL(offscreen ? "../entrypoints/offscreen/main.ts" : "../entrypoints/background.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env.FIREFOX", String(firefox))
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports: { default?: { main(): void }; handle?: (message: messages.TtsSpeakMessage, tabId: number) => Promise<void> } = {}
  vm.runInNewContext(outputText + (offscreen ? "" : "\nexports.handle = handleTtsFromPill"), {
    exports, browser, defineBackground: (value: unknown) => value,
    setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => name.endsWith("tts-messages") ? messages
      : name.endsWith("tts-host") ? { createTtsHost: () => ({ speak: (request: SpeakRequest) => requests.push(request) }) }
      : {},
  })
  if (!offscreen) exports.default!.main()
  const emit = async (message: unknown, sender: unknown) => {
    const responses: unknown[] = []
    const returns = listeners.map(fn => fn(message, sender, value => responses.push(value)))
    await new Promise(resolve => setImmediate(resolve))
    return { responses, returns }
  }
  return { start: exports.handle!, emit, deliveries, requests, transport }
}

const payload: messages.TtsSpeakMessage = {
  type: messages.TTS_SPEAK, text: "An article.", lang: "en", voice: "F1", speed: 1, token: "owner", livePage: true,
}
const request: messages.TtsPrepareBlockMessage = { type: messages.TTS_PREPARE_BLOCK, tabId: 12, token: "owner", block: 2 }
const sender = { id: "orateur-test" }

test("Chrome refresh relay accepts only internal extension pages and valid block requests", async () => {
  const h = routing(false)
  const result = await h.emit(request, sender)
  assert.ok(result.returns.includes(true), "Keeps Chrome's asynchronous response channel open")
  assert.deepEqual(result.responses, [h.transport.response])
  assert.deepEqual(h.deliveries, [{ tabId: 12, message: { type: messages.TTS_PREPARE_BLOCK, token: "owner", block: 2 } }])

  for (const [message, origin] of [
    [request, { id: "another-extension" }],
    [request, { ...sender, tab: { id: 12 } }],
    [{ ...request, tabId: -1 }, sender],
    [{ ...request, tabId: "12" }, sender],
    [{ ...request, block: -1 }, sender],
    [{ ...request, block: 1.5 }, sender],
    [{ ...request, token: "" }, sender],
    [{ ...request, token: null }, sender],
  ]) {
    const rejected = await h.emit(message, origin)
    assert.deepEqual(rejected.responses, [])
    assert.ok(!rejected.returns.includes(true))
    assert.equal(h.deliveries.length, 1, "Invalid requests never reach a tab")
  }
  h.transport.fail = true
  assert.deepEqual((await h.emit(request, sender)).responses, [null], "Transport failure cannot silently reuse stale text")
})

for (const offscreen of [false, true]) {
  test(`${offscreen ? "Chrome offscreen" : "Firefox"} refreshes live pages through their original tab and token only`, async () => {
    const h = routing(!offscreen, offscreen)
    const start = (value: messages.TtsSpeakMessage, tabId = 12) => offscreen ? h.emit(value, sender) : h.start(value, tabId)
    await start({ ...payload, tabId: 12 })
    assert.deepEqual(await h.requests[0]!.prepareParagraph!(2), h.transport.response)
    assert.deepEqual(h.deliveries, [{
      tabId: offscreen ? undefined : 12,
      message: offscreen ? request : { type: messages.TTS_PREPARE_BLOCK, token: "owner", block: 2 },
    }])
    h.transport.fail = true
    await assert.rejects(h.requests[0]!.prepareParagraph!(3), /Page disconnected/)
    h.transport.fail = false
    await start({ ...payload, tabId: 99, token: "next-owner", livePage: undefined }, 99)
    assert.equal(h.requests[1]!.prepareParagraph, undefined, "Selections and previews keep their supplied text")
    await h.requests[0]!.prepareParagraph!(4)
    assert.deepEqual(h.deliveries.at(-1), {
      tabId: offscreen ? undefined : 12,
      message: offscreen ? { ...request, block: 4 } : { type: messages.TTS_PREPARE_BLOCK, token: "owner", block: 4 },
    }, "An old callback cannot read a later owner's tab")
  })
}
