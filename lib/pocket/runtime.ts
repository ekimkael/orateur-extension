import type { PocketLanguage, PocketVoice } from "./catalog.ts"
import { loadPocketFile, pocketModelFiles } from "./model-cache.ts"

type Progress = { phase: "downloading-model"; progress: number } | { phase: "loading-engine" }
type Reply = { ok: true; pcm?: Float32Array; sampleRate?: number } | { ok: false }

interface WorkerSession {
  worker: Worker
  language: PocketLanguage
  voices: Set<string>
  sampleRate: number
  cancelRequest?: () => void
}

/**
 * A signal that aborts when either source does, with the first reason.
 * `AbortSignal.any` would do it, but needs Chrome 116 / Firefox 124 and the
 * manifest sets no minimum version. `release` detaches it from both sources,
 * so the runtime's long-lived lifetime signal does not keep one listener per
 * synthesized unit.
 */
export function eitherSignal(a: AbortSignal, b: AbortSignal): { signal: AbortSignal; release(): void } {
  const controller = new AbortController()
  const fromA = () => controller.abort(a.reason)
  const fromB = () => controller.abort(b.reason)
  const release = () => {
    a.removeEventListener("abort", fromA)
    b.removeEventListener("abort", fromB)
  }
  if (a.aborted) fromA()
  else if (b.aborted) fromB()
  else {
    a.addEventListener("abort", fromA, { once: true })
    b.addEventListener("abort", fromB, { once: true })
  }
  return { signal: controller.signal, release }
}

/** Load a single language model on demand and serialize requests on its worker. */
export function createPocketRuntime() {
  let session: WorkerSession | undefined
  const lifetime = new AbortController()
  let queue = Promise.resolve()

  function release() {
    const previous = session
    session = undefined
    previous?.cancelRequest?.()
    previous?.worker.terminate()
  }

  function request(target: WorkerSession, message: { type: string }, signal: AbortSignal, transfer: Transferable[] = []) {
    signal.throwIfAborted()
    return new Promise<Extract<Reply, { ok: true }>>((resolve, reject) => {
      const { worker } = target
      function cleanup() {
        worker.removeEventListener("message", reply)
        worker.removeEventListener("messageerror", failed)
        worker.removeEventListener("error", failed)
        signal.removeEventListener("abort", abort)
        target.cancelRequest = undefined
      }
      function cancel() {
        cleanup()
        reject(signal.reason ?? new DOMException("Pocket worker closed", "AbortError"))
      }
      function reply(event: MessageEvent<Reply>) {
        if (signal.aborted) return cancel()
        cleanup()
        if (event.data?.ok) resolve(event.data)
        else reject(new Error("Pocket worker could not complete the request"))
      }
      function failed() {
        cleanup()
        if (session === target) release()
        reject(new Error("Pocket worker failed"))
      }
      function abort() {
        // A loaded model can be reused after generation acknowledges cancellation.
        // Initialization is synchronous inside WASM, so stop it with the worker.
        if (message.type !== "synthesize") {
          release()
          return
        }
        try {
          worker.postMessage({ type: "cancel" })
        } catch {
          failed()
        }
      }
      target.cancelRequest = cancel
      signal.addEventListener("abort", abort, { once: true })
      worker.addEventListener("message", reply)
      worker.addEventListener("messageerror", failed)
      worker.addEventListener("error", failed)
      try {
        worker.postMessage(message, transfer)
      } catch {
        failed()
      }
    })
  }

  async function synthesize(
    text: string,
    voice: PocketVoice,
    language: PocketLanguage,
    options: { signal: AbortSignal; onProgress?: (state: Progress) => void; cacheOnly?: boolean },
  ): Promise<{ pcm: Float32Array; sampleRate: number }> {
    const { signal, release: unlink } = eitherSignal(options.signal, lifetime.signal)
    const run = queue.then(async () => {
      signal.throwIfAborted()
      const files = pocketModelFiles(language, voice)
      if (session?.language !== language) release()
      const needsVoice = !session?.voices.has(files.voiceName)
      const total = (session ? 0 : files.tokenizer.size + files.weights.size) + (needsVoice ? files.voice.size : 0)
      let loaded = 0
      let reported = -1
      async function load(file: typeof files.tokenizer | typeof files.weights | typeof files.voice) {
        const bytes = await loadPocketFile(file, signal, (size) => {
          const progress = Math.round((loaded + size) / total * 100)
          if (progress === reported) return
          reported = progress
          options.onProgress?.({ phase: "downloading-model", progress })
        }, options.cacheOnly)
        loaded += file.size
        return bytes
      }
      if (!session) {
        const tokenizer = await load(files.tokenizer)
        const weights = await load(files.weights)
        signal.throwIfAborted()
        options.onProgress?.({ phase: "loading-engine" })
        const worker = new Worker(browser.runtime.getURL("/pocket/worker.js"), { type: "module" })
        const target: WorkerSession = { worker, language, voices: new Set(), sampleRate: 0 }
        session = target
        try {
          const message = { type: "initialize", tokenizer, weights, language: files.language }
          const { sampleRate } = await request(target, message, signal, [tokenizer, weights])
          if (sampleRate !== 24000) throw new Error("Unexpected Pocket sample rate")
          target.sampleRate = sampleRate
        } catch (error) {
          release()
          throw error
        }
      }
      const target = session
      if (needsVoice) {
        const bytes = await load(files.voice)
        const message = { type: "voice", name: files.voiceName, bytes }
        await request(target, message, signal, [bytes])
        target.voices.add(files.voiceName)
      }
      const message = { type: "synthesize", text, voice: files.voiceName }
      const { pcm } = await request(target, message, signal)
      if (!(pcm instanceof Float32Array) || !pcm.length) throw new Error("Pocket returned no audio")
      return { pcm, sampleRate: target.sampleRate }
    })
    queue = run.then(unlink, unlink)
    return run
  }

  return {
    synthesize,
    dispose() {
      lifetime.abort()
      release()
    },
  }
}
