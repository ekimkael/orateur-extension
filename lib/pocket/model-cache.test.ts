import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test, { type TestContext } from "node:test"
import { loadPocketFile, pocketModelFiles } from "./model-cache.ts"

const model = new Uint8Array([1, 2, 3])
const file = {
  url: "https://models.example/pocket",
  size: model.byteLength,
  sha256: createHash("sha256").update(model).digest("hex"),
}

function mockCache(t: TestContext) {
  const entries = new Map<string, Response>()
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches")
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      async open() {
        return {
          async match(url: string) { return entries.get(url)?.clone() },
          async put(url: string, response: Response) { entries.set(url, response) },
          async delete(url: string) { return entries.delete(url) },
        }
      },
    },
  })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor)
    else Reflect.deleteProperty(globalThis, "caches")
  })
  return entries
}

test("Pocket validates cached bytes, replaces corruption, and then reads offline", async (t) => {
  const entries = mockCache(t)
  entries.set(file.url, new Response(new Uint8Array([9, 9, 9]), { headers: { "Content-Length": "3" } }))
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(model))
  const signal = new AbortController().signal
  const progress: number[] = []
  const downloaded = await loadPocketFile(file, signal, (bytes) => progress.push(bytes))
  assert.deepEqual(new Uint8Array(downloaded), model)
  assert.deepEqual(progress, [0, model.length])

  fetch.mock.mockImplementation(async () => { throw new Error("offline") })
  const cached = await loadPocketFile(file, signal, () => assert.fail("cache hit reported a download"))
  assert.deepEqual(new Uint8Array(cached), model)
  assert.equal(fetch.mock.callCount(), 1)
})

test("Pocket never caches truncated, oversized, or corrupt downloads", async (t) => {
  const entries = mockCache(t)
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(model))
  const signal = new AbortController().signal
  for (const bytes of [[1], [1, 2, 3, 4], [3, 2, 1]]) {
    fetch.mock.mockImplementation(async () => new Response(new Uint8Array(bytes)))
    await assert.rejects(loadPocketFile(file, signal, () => {}), /size|integrity/)
    assert.equal(entries.size, 0)
  }
})

test("Pocket cancels a download before it writes a completed response", async (t) => {
  const entries = mockCache(t)
  const controller = new AbortController()
  t.mock.method(globalThis, "fetch", async () => new Response(model))
  await assert.rejects(loadPocketFile(file, controller.signal, (loaded) => {
    if (loaded === model.length) controller.abort()
  }), { name: "AbortError" })
  assert.equal(entries.size, 0)
})

test("Pocket never downloads missing or corrupt files in cache-only mode", async (t) => {
  const entries = mockCache(t)
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(model))
  const signal = new AbortController().signal
  const load = () => loadPocketFile(file, signal, () => assert.fail("cache-only read reported a download"), true)
  await assert.rejects(load(), /unavailable offline/)
  entries.set(file.url, new Response(new Uint8Array([9, 9, 9]), { headers: { "Content-Length": "3" } }))
  await assert.rejects(load(), /unavailable offline/)
  entries.set(file.url, new Response(model, { headers: { "Content-Length": "3" } }))
  assert.deepEqual(new Uint8Array(await load()), model)
  assert.equal(fetch.mock.callCount(), 0)
})

test("Pocket chooses model-matched voices and preserves explicit voice choice", () => {
  const english = pocketModelFiles("en", "auto")
  const french = pocketModelFiles("fr", "auto")
  const albaInFrench = pocketModelFiles("fr", "alba")
  assert.match(english.voice.url, /english\/embeddings\/alba\.safetensors$/)
  assert.match(french.voice.url, /french\/embeddings\/estelle\.safetensors$/)
  assert.match(albaInFrench.voice.url, /french\/embeddings\/alba\.safetensors$/)
  assert.notEqual(english.voice.sha256, albaInFrench.voice.sha256)
  assert.equal(french.weights.url, albaInFrench.weights.url)
})
