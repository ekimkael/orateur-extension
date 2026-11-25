import type { ChunkedRuntime } from "../pocket-tts-host.ts"
import type { KaleVoice } from "./catalog.ts"

/** One synthesis request to Kale's worker. */
export interface KaleRequest {
  text: string
  voice: KaleVoice
  webGpu: boolean
  cacheOnly: boolean
}

/** Replies contain locally generated audio, progress or a host-only error. */
export type KaleReply =
  | { pcm: Float32Array; sampleRate: number }
  | { phase: "downloading-model"; progress: number }
  | { phase: "loading-engine" }
  | { error: string }

const GPU_TIMEOUT_MS = 45_000

/** Isolate Kale inference from the audio host and serialize calls to one model session. */
export function createKaleRuntime(): ChunkedRuntime<"en", KaleVoice> {
  let worker: Worker | undefined
  let queue = Promise.resolve()
  let disposed = false
  let gpuRequested = false
  let lastCacheOnly = false
  let gpuFailed = false

  function closeWorker() {
    worker?.terminate()
    worker = undefined
  }

  function synthesizeWithWorker(input: KaleRequest, signal: AbortSignal, onProgress: Parameters<ChunkedRuntime<"en", KaleVoice>["synthesize"]>[3]["onProgress"]) {
    signal.throwIfAborted()
    const target = worker ??= new Worker(browser.runtime.getURL("/kale-worker.js"), { type: "module" })
    return new Promise<{ pcm: Float32Array; sampleRate: number }>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let lastProgress = ""
      function finish() {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        target.onmessage = target.onmessageerror = target.onerror = null
      }
      function fail(error: unknown) {
        finish()
        closeWorker()
        reject(error)
      }
      function abort() {
        fail(signal.reason)
      }
      function watchGPU() {
        if (!input.webGpu) return
        clearTimeout(timer)
        timer = setTimeout(() => fail(new Error("Kale WebGPU did not respond")), GPU_TIMEOUT_MS)
      }
      signal.addEventListener("abort", abort, { once: true })
      target.onmessage = ({ data }: MessageEvent<KaleReply>) => {
        if (data && "phase" in data) {
          watchGPU()
          const progress = data.phase === "downloading-model" ? String(data.progress) : data.phase
          if (progress !== lastProgress) {
            lastProgress = progress
            onProgress?.(data)
          }
        } else if (data && "pcm" in data && data.pcm instanceof Float32Array && data.sampleRate === 24000) {
          finish()
          resolve(data)
        } else {
          fail(new Error(data && "error" in data ? data.error : "Kale returned invalid audio"))
        }
      }
      target.onmessageerror = target.onerror = () => fail(new Error("Kale worker failed"))
      try {
        watchGPU()
        target.postMessage(input)
      } catch (error) {
        fail(error)
      }
    })
  }

  return {
    synthesize(text, voice, _language, { signal, cacheOnly = false, webGpu = false, onProgress }) {
      const result = queue.then(async () => {
        signal.throwIfAborted()
        if (disposed) throw new Error("Kale runtime closed")
        if (webGpu !== gpuRequested || cacheOnly !== lastCacheOnly) {
          closeWorker()
          gpuRequested = webGpu
          lastCacheOnly = cacheOnly
          gpuFailed = false
        }
        if (webGpu && !gpuFailed) {
          try {
            return await synthesizeWithWorker({ text, voice, cacheOnly, webGpu: true }, signal, onProgress)
          } catch {
            signal.throwIfAborted()
            gpuFailed = true
            onProgress?.({ phase: "loading-engine" })
          }
        }
        return await synthesizeWithWorker({ text, voice, cacheOnly, webGpu: false }, signal, onProgress)
      })
      queue = result.then(() => {}, () => {})
      return result
    },
    dispose() {
      // The host aborts its in-flight request before disposing the runtime.
      disposed = true
      closeWorker()
    },
  }
}
