/**
 * Annonce parlée du titre, en tête de lecture.
 *
 * Readability retire le `h1` qui répète le titre : sans cette annonce, la
 * lecture démarre au premier paragraphe et on ne sait pas ce qu'on écoute.
 * Même formulation que mobile (`mobile/lib/reading-intro.ts`) pour que les
 * trois surfaces sonnent pareil.
 */

/**
 * Le français est la valeur de repli, pas une entrée de la table : sous
 * `noUncheckedIndexedAccess`, une clé de `Record<string, string>` est
 * optionnelle même écrite en dur, et un repli sur la table elle-même laisserait
 * passer `undefined`. Même schéma que `CODE_NOTICE` dans `extract-article`.
 */
const INTRO = "Au programme :"
const INTRO_BY_LANGUAGE: Record<string, string> = {
  en: "Coming up:",
  es: "Hoy escuchamos:",
  de: "Auf dem Programm:",
  it: "In programma:",
  pt: "No programa:",
}

/**
 * Ponctue un bloc qui ne l'est pas, pour que la synthèse y pose la chute et le
 * silence d'une fin de phrase. Sans point, un titre sort avec l'intonation
 * d'une phrase inachevée et le moteur enchaîne sans reprendre son souffle.
 *
 * Le guillemet et la parenthèse fermants comptent comme une ponctuation : la
 * phrase qu'ils referment porte déjà la sienne.
 */
export const withStop = (text: string) =>
  /[.!?…:»"')\]]$/.test(text) ? text : `${text}.`

/** Chaîne vide si l'article n'a pas de titre : pas d'annonce en suspens. */
export function buildReadingIntro(language: string, title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return ""
  // Code de langue absent ou inconnu : le français, langue du produit.
  const lead = INTRO_BY_LANGUAGE[language.slice(0, 2)] ?? INTRO
  return `${lead} ${withStop(trimmed)}`
}
