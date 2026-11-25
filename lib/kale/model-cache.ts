import { createModelFileCache, type ModelFile } from "../model-file-cache.ts"
import { KALE_FILES } from "./asset-files.ts"
import { KALE_VOICES, type KaleVoice } from "./catalog.ts"

/** Versioned sources for the weights, voices and English frontend. */
export const KALE_ASSET_ROOT = "https://huggingface.co/spaces/KaleComputer/kale-tts-1/resolve/3bab6511db89e4977504224861e1b5636debb6a3/"
/** CacheStorage namespace used by Kale. */
export const KALE_CACHE_NAME = "orateur-kale-tts-v1"
/** Names under the pinned asset root. */
export const KALE_MODEL_DIR = "models/kale-tts-1-tiny"
/** Shared CPU and GPU graph paths. */
export const KALE_GRAPHS = { wasm: `${KALE_MODEL_DIR}/model.onnx`, webgpu: `${KALE_MODEL_DIR}/model.fp32.onnx` } as const

const cache = createModelFileCache(KALE_CACHE_NAME, "Kale")

function file(path: string): ModelFile {
  const metadata = Object.hasOwn(KALE_FILES, path) ? KALE_FILES[path] : undefined
  if (!metadata) throw new Error("Unknown Kale asset")
  const [size, sha256] = metadata
  return { url: `${KALE_ASSET_ROOT}${path}`, size, sha256 }
}

/** Check the CPU graph and all data needed to speak with the selected voice offline. */
export function isKaleModelCached(voice: KaleVoice) {
  const prefix = KALE_VOICES.find(({ id }) => id === voice)?.accent === "en-gb" ? "frontend/words/en-gb" : "frontend/words"
  return cache.has([
    KALE_GRAPHS.wasm, `${KALE_MODEL_DIR}/voices.json`, `${KALE_MODEL_DIR}/tokenizer.json`,
    `${KALE_MODEL_DIR}/ettin-tokenizer.json`, `${KALE_MODEL_DIR}/voices/${voice}.bin`, `${KALE_MODEL_DIR}/voices/${voice}.extra.bin`,
    ...["lexicon.tsv", "override.public.tsv", "terms.tsv", "g2p.bin"].map(name => `${prefix}/${name}`),
  ].map(file))
}

/** Detect a complete CPU graph before bringing down the larger GPU graph. */
export function hasKaleCpuGraph() {
  return cache.has([file(KALE_GRAPHS.wasm)])
}

/** Resolve a pinned asset and verify it before it reaches ONNX or the frontend. */
export function loadKaleFile(path: string, signal: AbortSignal, progress?: (loaded: number, total: number) => void, cacheOnly = false) {
  const asset = file(path)
  return cache.load(asset, signal, loaded => progress?.(loaded, asset.size), cacheOnly)
}

/** Report the space used by both Kale graph variants and their shared data. */
export const getKaleModelCacheSize = cache.size

/** Delete the saved Kale graphs, voices and dictionaries. */
export const clearKaleModelCache = cache.clear
