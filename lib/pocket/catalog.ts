/** Document languages supported by the packaged Pocket models. */
export const POCKET_LANGUAGES = ["en", "fr"] as const

/** Base language of a Pocket model. */
export type PocketLanguage = typeof POCKET_LANGUAGES[number]

/** Saved voice choices. Auto uses the default voice for the document language. */
export const POCKET_VOICES = ["auto", "alba", "estelle"] as const

/** A voice choice saved independently of other engines. */
export type PocketVoice = typeof POCKET_VOICES[number]

/** Match the default voice to the document language. */
export const DEFAULT_POCKET_VOICE: PocketVoice = "auto"

/** Reduce a language tag to a supported Pocket model language. */
export function toPocketLanguage(tag: string): PocketLanguage | null {
  const code = tag.split("-")[0]?.toLowerCase()
  return code === "en" || code === "fr" ? code : null
}

/** Validate a Pocket voice from extension storage or messages. */
export function isPocketVoice(value: unknown): value is PocketVoice {
  return POCKET_VOICES.some((voice) => voice === value)
}
