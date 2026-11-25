/** Voice IDs and labels from the pinned Tiny model catalog. */
export const KALE_VOICES = [
  { id: "s057b", text: "Kenzie (en-US)", accent: "en-us" },
  { id: "f06", text: "Simone (en-US)", accent: "en-us" },
  { id: "d03", text: "Amy (en-GB)", accent: "en-gb" },
  { id: "w165", text: "Frankie (en-US)", accent: "en-us" },
  { id: "w602", text: "Darlene (en-US)", accent: "en-us" },
  { id: "m3", text: "Owen (en-US)", accent: "en-us" },
  { id: "t071", text: "Toby (en-US)", accent: "en-us" },
  { id: "d13", text: "Jack (en-GB)", accent: "en-gb" },
  { id: "x328", text: "Earl (en-US)", accent: "en-us" },
  { id: "h013f", text: "Magnus (en-US)", accent: "en-us" },
] as const

/** Voice ID saved independently of the other engines. */
export type KaleVoice = typeof KALE_VOICES[number]["id"]

/** Validate the configured voice before handing it to the worker. */
export function isKaleVoice(value: unknown): value is KaleVoice {
  return KALE_VOICES.some(({ id }) => id === value)
}
