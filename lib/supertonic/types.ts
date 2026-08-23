// lib/supertonic/types.ts
//
// Copié de web/app/lib/supertonic/types.ts, à un delta près — trois dépôts
// séparés, pas de workspace pour partager ça autrement. Voir engine.ts pour
// les deux deltas du moteur.
//
// Delta de ce fichier : SUPERTONIC_VOICE_LABEL_KEYS porte des clés i18n
// (jalon 1a), pas les libellés français que web/app garde en dur — l'exception
// à documenter si ce fichier est ressynchronisé depuis web/app.

export const SUPERTONIC_VOICES = [
  "M1", "M2", "M3", "M4", "M5",
  "F1", "F2", "F3", "F4", "F5",
] as const

export type SupertonicVoice = (typeof SUPERTONIC_VOICES)[number]

/**
 * Clés i18n (public/_locales/<locale>/messages.json), pas encore le texte : ce module
 * est importé par lib/tts-host.ts, qui n'a pas accès à `browser.i18n` (voir son
 * en-tête) — c'est à l'appelant côté UI (page d'options, popup) de résoudre la
 * clé avec `browser.i18n.getMessage(...)`. Mêmes clés que la liste dupliquée
 * dans reader.content.ts, pour que les deux restent traduites pareil.
 */
export const SUPERTONIC_VOICE_LABEL_KEYS: Record<SupertonicVoice, string> = {
  M1: "voiceMale1",
  M2: "voiceMale2",
  M3: "voiceMale3",
  M4: "voiceMale4",
  M5: "voiceMale5",
  F1: "voiceFemale1",
  F2: "voiceFemale2",
  F3: "voiceFemale3",
  F4: "voiceFemale4",
  F5: "voiceFemale5",
}

export type ModelStatus = "idle" | "loading" | "ready" | "error"

export interface DownloadProgress {
  modelName: string
  modelIndex: number
  totalModels: number
  bytesLoaded: number
  bytesTotal: number
}

const HF_BASE ="https://huggingface.co/Supertone/supertonic-3/resolve/main"

export const ONNX_FILES = [
  { name: "tts.json", path: `${HF_BASE}/onnx/tts.json` },
  { name: "unicode_indexer.json", path: `${HF_BASE}/onnx/unicode_indexer.json` },
  { name: "duration_predictor.onnx", path: `${HF_BASE}/onnx/duration_predictor.onnx` },
  { name: "text_encoder.onnx", path: `${HF_BASE}/onnx/text_encoder.onnx` },
  { name: "vector_estimator.onnx", path: `${HF_BASE}/onnx/vector_estimator.onnx` },
  { name: "vocoder.onnx", path: `${HF_BASE}/onnx/vocoder.onnx` },
] as const

export const VOICE_STYLE_BASE = `${HF_BASE}/voice_styles`
