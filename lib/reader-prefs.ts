import type { SupertonicVoice } from "./supertonic/types.ts"

export type ReaderEngine = "system" | "supertonic"

export type PillPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

/**
 * Bornes du curseur de vitesse.
 *
 * `speechSynthesis` refuse un `rate` hors [0.1, 10] en levant : la borne est
 * bien plus serrée ici, une lecture au-delà n'étant plus intelligible. Même
 * plage pour Supertonic (`audio.playbackRate`) : un seul curseur pour les
 * deux moteurs.
 */
export const SPEED = { min: 0.8, max: 1.5, step: 0.1 } as const

export interface ReaderPreferences {
  engine: ReaderEngine
  speed: number
  voiceURI: string | null
  /**
   * Séparée de `voiceURI` plutôt que de le réutiliser : changer de moteur ne
   * doit pas faire oublier le choix de voix de l'autre. `F1` par défaut —
   * une voix concrète plutôt qu'un vide, Supertonic n'a pas de « laisser le
   * navigateur choisir ».
   */
  supertonicVoice: SupertonicVoice
  /**
   * Suivre la lecture sur la page : surligner le paragraphe lu et l'amener
   * dans le champ de vision.
   *
   * Un seul réglage pour les deux gestes — ils n'ont d'intérêt qu'ensemble,
   * un surlignage hors écran ne se voit pas. À séparer le jour où quelqu'un
   * veut l'un sans l'autre.
   */
  follow: boolean
  /** Coin (ou centre) de l'écran où poser la pastille. */
  position: PillPosition
}

const PREFS_KEY = "orateur:reader-prefs"
const DEFAULT_PREFS: ReaderPreferences = {
  engine: "system",
  speed: 1,
  voiceURI: null,
  supertonicVoice: "F1",
  follow: true,
  position: "bottom-right",
}

export async function loadPrefs(): Promise<ReaderPreferences> {
  const data = await browser.storage.local.get(PREFS_KEY)
  const stored = data[PREFS_KEY] as Partial<ReaderPreferences> | undefined
  const prefs = { ...DEFAULT_PREFS, ...stored }
  // Le storage n'est pas une source sûre : une version précédente de
  // l'extension ou une édition manuelle peut y laisser une vitesse que la
  // synthèse refuserait, et l'exception tomberait au `speak()`.
  return { ...prefs, speed: clampSpeed(prefs.speed) }
}

export async function savePrefs(prefs: Partial<ReaderPreferences>) {
  // Le `set` doit être attendu : sans ça deux réglages cliqués coup sur coup
  // relisent tous les deux l'état d'avant, et le second écrase le premier.
  const current = await loadPrefs()
  await browser.storage.local.set({ [PREFS_KEY]: { ...current, ...prefs } })
}

export function onPrefsChanged(callback: (prefs: ReaderPreferences) => void) {
  const handler = (changes: Record<string, any>) => {
    if (PREFS_KEY in changes) {
      const newVal = changes[PREFS_KEY].newValue as Partial<ReaderPreferences> | undefined
      const prefs = { ...DEFAULT_PREFS, ...newVal }
      callback({ ...prefs, speed: clampSpeed(prefs.speed) })
    }
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}

function clampSpeed(speed: unknown) {
  if (typeof speed !== "number" || !Number.isFinite(speed)) return DEFAULT_PREFS.speed
  return Math.min(SPEED.max, Math.max(SPEED.min, speed))
}
