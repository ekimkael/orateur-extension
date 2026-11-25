import { createModelFileCache } from "../model-file-cache.ts"
import { PHONON_FILES, phononManifest, type PhononLanguage } from "./config.ts"

const cache = createModelFileCache("orateur-phonon-tts-v1", "Phonon", { resumeDownloads: true })

/** Source and integrity metadata for the assets needed by a language. */
export function phononModelFiles(lang: PhononLanguage) {
  if (!phononManifest) throw new Error("Phonon model source is unavailable")
  const { baseUrl, files } = phononManifest
  const asset = (key: keyof typeof PHONON_FILES) => ({
    ...files[key],
    url: new URL(PHONON_FILES[key], baseUrl).href,
  })
  return [asset("weights"), asset("tokenizer"), asset("config"), asset(lang)] as const
}

/** Check the assets needed for a reading without downloading or decoding them. */
export function isPhononModelCached(lang?: PhononLanguage) {
  if (!phononManifest) return Promise.resolve(false)
  return lang ? cache.has(phononModelFiles(lang)) : cache.has([
    ...phononModelFiles("en"), phononModelFiles("fr")[3],
  ])
}

/** Load one complete file with integrity verification before it reaches WASM. */
export const loadPhononFile = cache.load
/** Report storage used by the shared model and its voices. */
export const getPhononModelCacheSize = cache.size
/** Remove the Phonon models and voices from persistent storage. */
export const clearPhononModelCache = cache.clear
