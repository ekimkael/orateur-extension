/**
 * Langues gérées par Supertonic, et la résolution d'une balise BCP 47 vers
 * l'une d'elles.
 *
 * Sorti de `lib/supertonic/engine.ts`, qui la réimporte : c'est cette
 * fonction qui arbitre entre « lu en Supertonic » et « repli sur le moteur
 * système », donc celle qui n'a pas le droit de se tromper — et la seule
 * partie de tout ça qui vaut la peine d'être testée sous `node --test` plutôt
 * qu'à l'oreille.
 */
export const AVAILABLE_LANGS = [
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
  "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
  "ru", "sk", "sl", "sv", "tr", "uk", "vi", "na",
] as const

export type SupportedLang = (typeof AVAILABLE_LANGS)[number]

const SUPPORTED = new Set<string>(AVAILABLE_LANGS)

/**
 * Réduit une balise de langue (`fr-FR`, `FR`…) à son code Supertonic, ou
 * `null` si le modèle ne la connaît pas.
 *
 * Seul le sous-tag de langue compte — jamais la région : `chunkText` du côté
 * moteur ne la voit pas non plus.
 */
export function toSupertonicLang(tag: string): SupportedLang | null {
  const code = tag.split("-")[0]?.toLowerCase()
  return code && SUPPORTED.has(code) ? (code as SupportedLang) : null
}
