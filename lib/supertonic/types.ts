// lib/supertonic/types.ts
//
// Copié de web/app/lib/supertonic/types.ts sans modification — trois dépôts
// séparés, pas de workspace pour partager ça autrement. Voir engine.ts pour
// les deux seuls deltas du portage.

export const SUPERTONIC_VOICES = [
  "M1", "M2", "M3", "M4", "M5",
  "F1", "F2", "F3", "F4", "F5",
] as const

export type SupertonicVoice = (typeof SUPERTONIC_VOICES)[number]

export const SUPERTONIC_VOICE_LABELS: Record<SupertonicVoice, string> = {
  M1: "Homme 1",
  M2: "Homme 2",
  M3: "Homme 3",
  M4: "Homme 4",
  M5: "Homme 5",
  F1: "Femme 1",
  F2: "Femme 2",
  F3: "Femme 3",
  F4: "Femme 4",
  F5: "Femme 5",
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
