import { DEFAULT_POCKET_VOICE, POCKET_LANGUAGES, type PocketLanguage, type PocketVoice } from "./catalog.ts"

/** Immutable download metadata from the Hugging Face repositories. */
export interface PocketFile {
  url: string
  size: number
  sha256: string
}

const CACHE = "orateur-pocket-tts-v1"
const MODELS = "https://huggingface.co/idle-intelligence/pocket-tts-gguf/resolve/dab28d3740c448b4932d4414b4e473ee16b14331"
// Voice states must come from the original model revision used for quantization.
const VOICES = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/4e1e0a3e611c51c0b4ed8174fc10f32a54644303"
const CATALOG = {
  en: {
    directory: "english",
    defaultVoice: "alba",
    weights: "ac2fcfc747fb89708c7f7b11d011a33c9e47ccd70235c40a44528b51c62301b4",
    tokenizer: [59339, "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6"],
    alba: "d291428b416d6c36a1de7835e51dbe1e334b75e5af512bb18dd23a1047fe8f3b",
    estelle: "62bcdb95745e71c60259974ac8547557fa23cece479bf6cc88d68cb84a970cdc",
  },
  fr: {
    directory: "french",
    defaultVoice: "estelle",
    weights: "74fa7e52eb8e1f5291a73c7f354556975fa53b17abda23042b19dc07a976ece5",
    tokenizer: [60690, "dd8dc8cfad3c4b3711a8629ede27d5be934eb98bcb00462bf91ed40fb8f6f38a"],
    alba: "488e9862894d735c77f4dc7965237b640fbb599d117b57f898af005c53e195c1",
    estelle: "f763800c6865a7c13e3368db7c24345d7ab22abd06c2ca40a3428d14c5357248",
  },
} as const

/** Resolve only fixed, versioned files for the selected model and voice. */
export function pocketModelFiles(lang: PocketLanguage, voice: PocketVoice) {
  const model = CATALOG[lang]
  const voiceName = voice === "auto" ? model.defaultVoice : voice
  const dir = `languages/${model.directory}`
  return {
    language: model.directory,
    voiceName,
    tokenizer: {
      url: `${MODELS}/${dir}/tokenizer.model`,
      size: model.tokenizer[0],
      sha256: model.tokenizer[1],
    },
    weights: {
      url: `${MODELS}/${dir}/pocket-tts-q8_0.gguf`,
      size: 133837984,
      sha256: model.weights,
    },
    voice: {
      url: `${VOICES}/${dir}/embeddings/${voiceName}.safetensors`,
      size: voiceName === "alba" ? 6195000 : 8259384,
      sha256: model[voiceName],
    },
  }
}

async function openCache(): Promise<Cache | undefined> {
  try {
    return await globalThis.caches?.open(CACHE)
  } catch {
    // CacheStorage can be unavailable in private browsing.
    return undefined
  }
}

/** Check if a specific model and voice are present without loading model bytes. */
export async function isPocketModelCached(lang?: PocketLanguage, voice = DEFAULT_POCKET_VOICE): Promise<boolean> {
  const cache = await openCache()
  if (!cache) return false
  try {
    for (const language of lang ? [lang] : POCKET_LANGUAGES) {
      const { tokenizer, weights, voice: voiceFile } = pocketModelFiles(language, voice)
      const present = await Promise.all([tokenizer, weights, voiceFile].map(async (file) => (
        (await cache.match(file.url))?.headers.get("Content-Length") === String(file.size)
      )))
      if (present.every(Boolean)) return true
    }
  } catch {
    return false
  }
  return false
}

/** Report the bytes cached by Pocket independently of other engines. */
export async function getPocketModelCacheSize(): Promise<number | null> {
  const cache = await openCache()
  if (!cache) return null
  try {
    let size = 0
    for (const request of await cache.keys()) {
      const bytes = Number((await cache.match(request))?.headers.get("Content-Length"))
      if (Number.isSafeInteger(bytes) && bytes > 0) size += bytes
    }
    return size
  } catch {
    return null
  }
}

/** Remove Pocket models and voice states from persistent storage. */
export async function clearPocketModelCache(): Promise<void> {
  await caches.delete(CACHE)
}

async function verified(bytes: ArrayBuffer, file: PocketFile) {
  if (bytes.byteLength !== file.size) return false
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") === file.sha256
}

async function readVerified(
  response: Response,
  file: PocketFile,
  signal: AbortSignal,
  onProgress?: (loaded: number) => void,
): Promise<ArrayBuffer> {
  if (!response.body) throw new Error("Pocket model has no data")
  const bytes = new Uint8Array(new ArrayBuffer(file.size))
  const reader = response.body.getReader()
  let offset = 0
  let ended = false
  try {
    onProgress?.(0)
    for (;;) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) {
        ended = true
        break
      }
      if (offset + value.byteLength > bytes.byteLength) throw new Error("Pocket model exceeds its published size")
      bytes.set(value, offset)
      offset += value.byteLength
      onProgress?.(offset)
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  if (offset !== file.size || !await verified(bytes.buffer, file)) throw new Error("Pocket model integrity check failed")
  signal.throwIfAborted()
  return bytes.buffer
}

/** Read a bounded file, verify its digest, and cache only complete downloads. */
export async function loadPocketFile(
  file: PocketFile,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  cacheOnly = false,
): Promise<ArrayBuffer> {
  const cache = await openCache()
  signal.throwIfAborted()
  try {
    const cached = await cache?.match(file.url)
    if (cached) {
      if (cached.headers.get("Content-Length") === String(file.size)) {
        const bytes = await readVerified(cached, file, signal).catch(() => null)
        if (bytes) return bytes
      }
      signal.throwIfAborted()
      await cache?.delete(file.url)
    }
  } catch {
    // A cache failure is recoverable while the model is reachable.
  }
  signal.throwIfAborted()
  if (cacheOnly) throw new Error("Verified Pocket model is unavailable offline")
  const response = await fetch(file.url, { signal, credentials: "omit", referrerPolicy: "no-referrer" })
  if (!response.ok) throw new Error(`Pocket model download failed (HTTP ${response.status})`)
  const bytes = await readVerified(response, file, signal, onProgress)
  try {
    await cache?.put(file.url, new Response(bytes, { headers: { "Content-Length": String(file.size) } }))
  } catch {
    // Cache quota must not prevent an otherwise valid reading.
  }
  signal.throwIfAborted()
  return bytes
}
