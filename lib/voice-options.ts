import { POCKET_VOICES } from "./pocket/catalog.ts"
import { SUPERTONIC_VOICES, SUPERTONIC_VOICE_LABEL_KEYS } from "./supertonic/types.ts"

type MessageKey = Parameters<typeof browser.i18n.getMessage>[0]

/** One entry of a voice menu: an i18n key to translate, or a name shown as is. */
export type VoiceOption = { id: string; key: MessageKey } | { id: string; text: string }

/**
 * The voices a local engine offers, in the order the pill and the options page
 * both show them. Supertonic lists its female voices first, since F1 is the
 * default; Pocket's voices are proper names, except its automatic choice.
 */
export function voiceOptions(engine: "supertonic" | "pocket"): VoiceOption[] {
  if (engine === "pocket") {
    return POCKET_VOICES.map((id) => id === "auto"
      ? { id, key: "voicePocketAuto" }
      : { id, text: id[0]!.toUpperCase() + id.slice(1) })
  }
  return [...SUPERTONIC_VOICES].sort().map((id) => ({ id, key: SUPERTONIC_VOICE_LABEL_KEYS[id] as MessageKey }))
}
