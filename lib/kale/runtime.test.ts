import assert from "node:assert/strict"
import test from "node:test"
import { createKaleRuntime, type KaleReply, type KaleRequest } from "./runtime.ts"

function audioWorkers() {
  const workers: FakeWorker[] = []
  const requests: KaleRequest[] = []
  class FakeWorker {
    onmessage?: ((event: { data: KaleReply }) => void) | null
    terminated = false
    constructor() { workers.push(this) }
    terminate() { this.terminated = true }
    postMessage(input: KaleRequest) {
      requests.push(input)
      queueMicrotask(() => this.onmessage?.({ data: input.webGpu
        ? { error: "GPU device lost" }
        : { sampleRate: 24000, pcm: new Float32Array([0.5]) },
      }))
    }
  }
  const original = { worker: globalThis.Worker, browser: globalThis.browser }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  globalThis.browser = { runtime: { getURL: (path: string) => path } } as unknown as typeof browser
  return {
    workers, requests,
    restore() {
      globalThis.Worker = original.worker
      globalThis.browser = original.browser
    },
  }
}

test("Kale uses the working CPU session after GPU failure and keeps cache-only requests offline", async t => {
  const h = audioWorkers()
  const runtime = createKaleRuntime()
  t.after(() => { runtime.dispose(); h.restore() })
  const input = { signal: new AbortController().signal, webGpu: true, cacheOnly: true }

  assert.deepEqual((await runtime.synthesize("Hello.", "d03", "en", input)).pcm, new Float32Array([0.5]))
  await runtime.synthesize("Again.", "d03", "en", input)
  assert.deepEqual(h.requests.map(({ webGpu, cacheOnly }) => [webGpu, cacheOnly]), [[true, true], [false, true], [false, true]])
  assert.deepEqual(h.workers.map(worker => worker.terminated), [true, false])
})

test("Kale does not attempt WebGPU before opt-in or retry an aborted reading on the CPU", async t => {
  const h = audioWorkers()
  const runtime = createKaleRuntime()
  t.after(() => { runtime.dispose(); h.restore() })

  const controller = new AbortController()
  await runtime.synthesize("Hello.", "d03", "en", { signal: controller.signal })
  const pending = runtime.synthesize("Again.", "d03", "en", { signal: controller.signal, webGpu: true })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, { name: "AbortError" })
  assert.deepEqual(h.requests.map(({ webGpu }) => webGpu), [false, true])
})
