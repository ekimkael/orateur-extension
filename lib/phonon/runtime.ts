import type { PhononTTS } from "phonon-tts"
import type { ChunkedRuntime } from "../pocket-tts-host.ts"
import { eitherSignal } from "../pocket/runtime.ts"
import type { PhononLanguage } from "./config.ts"
import { loadPhononFile, phononModelFiles } from "./model-cache.ts"

/** Adapt the bundled Phonon worker to the bounded local playback queue. */
export function createPhononRuntime(): ChunkedRuntime<PhononLanguage, "auto"> {
  let session: { lang: PhononLanguage; model: PhononTTS } | undefined
  const lifetime = new AbortController()
  let queue = Promise.resolve()

  return {
    synthesize(text, _voice, lang, options) {
      const { signal, release } = eitherSignal(options.signal, lifetime.signal)
      const job = queue.then(async () => {
        signal.throwIfAborted()
        if (session?.lang !== lang) {
          session?.model.dispose()
          session = undefined
          const files = phononModelFiles(lang)
          const total = files.reduce((sum, file) => sum + file.size, 0)
          let loaded = 0
          const urls: string[] = []
          try {
            for (const file of files) {
              const bytes = await loadPhononFile(file, signal, (received) => {
                options.onProgress?.({ phase: "downloading-model", progress: Math.round((loaded + received) / total * 100) })
              }, options.cacheOnly)
              urls.push(URL.createObjectURL(new Blob([bytes])))
              loaded += file.size
            }
            signal.throwIfAborted()
            options.onProgress?.({ phase: "loading-engine" })
            // Keep the SDK and its relative worker/WASM imports inside the extension package.
            const sdkUrl = browser.runtime.getURL("/") + "phonon/index.js"
            const sdk = await import(/* @vite-ignore */ sdkUrl) as typeof import("phonon-tts")
            signal.throwIfAborted()
            const [weights, tokenizer, config, voice] = urls
            const model = await sdk.PhononTTS.load({
              lang,
              cache: false,
              device: "cpu",
              model: { weights: { q8: weights! }, tokenizer: tokenizer!, config: config!, voices: { default: voice! } },
            })
            if (signal.aborted) {
              model.dispose()
              signal.throwIfAborted()
            }
            if (model.languages.length && !model.languages.includes(lang)) {
              model.dispose()
              throw new Error("The Phonon checkpoint does not support " + lang)
            }
            session = { lang, model }
          } finally {
            for (const url of urls) URL.revokeObjectURL(url)
          }
        }
        const { model } = session!
        const pcm = await model.synth(text, { signal })
        signal.throwIfAborted()
        if (!pcm.length) throw new Error("Phonon returned no audio")
        return { pcm, sampleRate: model.sampleRate }
      })
      queue = job.then(release, release)
      return job
    },
    dispose() {
      lifetime.abort()
      session?.model.dispose()
      session = undefined
    },
  }
}
