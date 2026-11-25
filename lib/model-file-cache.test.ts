import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { createModelFileCache } from "./model-file-cache.ts"

test("model cache retries failures and serves verified assets without a network request", async (t) => {
  const responses = new Map<string, Response>()
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches")
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { open: async () => ({
      match: async (url: string) => responses.get(url)?.clone(),
      put: async (url: string, response: Response) => responses.set(url, response),
      delete: async (url: string) => responses.delete(url),
    }) },
  })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor)
    else Reflect.deleteProperty(globalThis, "caches")
  })
  const data = "model"
  const file = {
    url: "https://models.example/v1/weights",
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  }
  const signal = new AbortController().signal
  const cache = createModelFileCache("tts", "Test")
  let response = new Response("error", { status: 503 })
  const fetch = t.mock.method(globalThis, "fetch", async () => response)

  await assert.rejects(cache.load(file, signal, undefined, true), /unavailable offline/)
  assert.equal(fetch.mock.callCount(), 0)
  await assert.rejects(cache.load(file, signal), /HTTP 503/)
  response = new Response("wrong")
  await assert.rejects(cache.load(file, signal), /integrity check failed/)
  assert.equal(await cache.has([file]), false)

  response = new Response(data)
  assert.equal(new TextDecoder().decode(await cache.load(file, signal)), data)
  assert.equal(await cache.has([file]), true)
  assert.equal(new TextDecoder().decode(await cache.load(file, signal, undefined, true)), data)
  assert.equal(fetch.mock.callCount(), 3)
  assert.equal(fetch.mock.calls[2]?.arguments[1]?.credentials, "omit")
})
