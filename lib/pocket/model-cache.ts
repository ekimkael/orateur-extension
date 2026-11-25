import { DEFAULT_POCKET_VOICE, POCKET_LANGUAGES, type PocketLanguage, type PocketVoice } from "./catalog.ts"

import { createModelFileCache } from "../model-file-cache.ts"

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

const cache = createModelFileCache(CACHE, "Pocket")

/** Check if a specific model and voice are present without loading model bytes. */
export async function isPocketModelCached(lang?: PocketLanguage, voice = DEFAULT_POCKET_VOICE): Promise<boolean> {
  for (const language of lang ? [lang] : POCKET_LANGUAGES) {
    const { tokenizer, weights, voice: voiceFile } = pocketModelFiles(language, voice)
    if (await cache.has([tokenizer, weights, voiceFile])) return true
  }
  return false
}

/** Report the bytes cached by Pocket independently of other engines. */
export const getPocketModelCacheSize = cache.size

/** Remove Pocket models and voice states from persistent storage. */
export const clearPocketModelCache = cache.clear

/** Read a bounded file, verify its digest, and cache only complete downloads. */
export const loadPocketFile = cache.load
