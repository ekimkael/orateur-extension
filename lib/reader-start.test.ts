import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

interface Payload {
  text: string
  title?: string
  lang?: string
}

function readerStart(firefox: boolean, options: { loaded?: boolean; injectionFails?: boolean; deliveryFails?: boolean } = {}) {
  let loaded = options.loaded ?? false
  const deliveries: { tabId: number; message: unknown }[] = []
  const injections: unknown[][] = []
  const sendMessage = async (tabId: number, message: unknown) => {
    deliveries.push({ tabId, message: structuredClone(message) })
    if (!loaded || options.deliveryFails) throw new Error("Receiving end does not exist")
  }
  const executeScript = async (...args: unknown[]) => {
    injections.push(structuredClone(args))
    if (options.injectionFails) throw new Error("Cannot access this page")
    loaded = true
    return []
  }
  const browser = firefox
    ? { tabs: { sendMessage, executeScript } }
    : { tabs: { sendMessage }, scripting: { executeScript } }
  const source = readFileSync(new URL("../entrypoints/background.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env.FIREFOX", String(firefox))
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports: { startReading?: (tabId: number, payload: Payload, fromHere?: boolean) => Promise<boolean> } = {}
  vm.runInNewContext(`${outputText}\nexports.startReading = startReading`, {
    exports,
    browser,
    defineBackground: (configuration: unknown) => configuration,
    require: (name: string) => name === "./reader.content" ? { START_READING: "orateur:start-reading" } : {},
  })
  return { start: exports.startReading!, deliveries, injections }
}

const payload: Payload = { text: "Article already open before installation.", title: "Existing tab", lang: "en" }

for (const firefox of [false, true]) {
  const browserName = firefox ? "Firefox" : "Chrome"

  test(`reading an existing tab injects its missing reader and preserves the request (${browserName})`, async () => {
    const { start, deliveries, injections } = readerStart(firefox)
    assert.equal(await start(7, payload, true), true)
    const delivery = { tabId: 7, message: { type: "orateur:start-reading", fromHere: true, ...payload } }
    assert.deepEqual(deliveries, [delivery, delivery])
    assert.deepEqual(injections, firefox
      ? [[7, { file: "/content-scripts/reader.js" }]]
      : [[{ target: { tabId: 7 }, files: ["/content-scripts/reader.js"] }]])
  })

  test(`reading an initialized tab needs no injection (${browserName})`, async () => {
    const { start, deliveries, injections } = readerStart(firefox, { loaded: true })
    assert.equal(await start(7, payload), true)
    assert.deepEqual(deliveries, [{ tabId: 7, message: { type: "orateur:start-reading", fromHere: false, ...payload } }])
    assert.deepEqual(injections, [])
  })

  test(`a restricted tab fails without retrying delivery after rejected injection (${browserName})`, async () => {
    const { start, deliveries, injections } = readerStart(firefox, { injectionFails: true })
    assert.equal(await start(7, payload), false)
    assert.equal(deliveries.length, 1)
    assert.equal(injections.length, 1)
  })

  test(`an unreachable reader after injection returns false without looping (${browserName})`, async () => {
    const { start, deliveries, injections } = readerStart(firefox, { deliveryFails: true })
    assert.equal(await start(7, payload), false)
    assert.equal(deliveries.length, 2)
    assert.equal(injections.length, 1)
  })
}
