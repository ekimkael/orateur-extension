/** The two languages offered by Orateur's Phonon engine. */
export type PhononLanguage = "en" | "fr"

/** The upstream model name shown in builds with Phonon enabled. */
export const PHONON_NAME = "Phonon"

/** The same checkpoint is used by both languages, with one voice each. */
export const PHONON_FILES = {
  weights: "model.q8.gguf",
  tokenizer: "tokenizer.json",
  config: "config.json",
  en: "en.safetensors",
  fr: "fr.safetensors",
} as const

type PhononAsset = keyof typeof PHONON_FILES

/** Build-time source manifest for the pinned checkpoint and its voices. */
export interface PhononManifest {
  baseUrl: string
  files: Record<PhononAsset, { size: number; sha256: string }>
}

declare const __ORATEUR_PHONON__: PhononManifest | null

/** Production builds without an authorized source omit the experimental engine. */
export const phononManifest = typeof __ORATEUR_PHONON__ === "undefined" ? null : __ORATEUR_PHONON__

/** Test a resolved document language at the port and player boundaries. */
export function isPhononLanguage(lang: unknown): lang is PhononLanguage {
  return lang === "en" || lang === "fr"
}
