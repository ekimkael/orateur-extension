import type { SupertonicVoice } from "./supertonic/types.ts"
import { DEFAULT_POCKET_VOICE, isPocketVoice, type PocketVoice } from "./pocket/catalog.ts"
import { ENGINE_CAPABILITIES } from "./engine-capabilities.ts"

/** Speech engines available to the reader. */
export type ReaderEngine = "system" | "supertonic" | "pocket"

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
 * plage pour les moteurs locaux (`audio.playbackRate`).
 */
export const SPEED = { min: 0.8, max: 1.5, step: 0.1 } as const

/** Reading settings stored per browser profile. */
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
  /** Independent of the user's system and Supertonic voice choices. */
  pocketVoice: PocketVoice
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
let pendingWrite = Promise.resolve()
const DEFAULT_PREFS: ReaderPreferences = {
  engine: "supertonic",
  speed: 1,
  voiceURI: null,
  supertonicVoice: "F1",
  pocketVoice: DEFAULT_POCKET_VOICE,
  follow: true,
  position: "bottom-right",
}

function normalizePrefs(value: unknown): ReaderPreferences {
  const stored = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ReaderPreferences>
    : undefined
  const prefs = { ...DEFAULT_PREFS, ...stored }
  // Stored values can come from older builds or manual edits.
  return {
    ...prefs,
    engine: typeof prefs.engine === "string" && Object.hasOwn(ENGINE_CAPABILITIES, prefs.engine) ? prefs.engine : "system",
    speed: clampSpeed(prefs.speed),
    pocketVoice: isPocketVoice(prefs.pocketVoice) ? prefs.pocketVoice : DEFAULT_POCKET_VOICE,
  }
}

/** Loads stored preferences with defaults for fields added by later builds. */
export async function loadPrefs(): Promise<ReaderPreferences> {
  const data = await browser.storage.local.get(PREFS_KEY)
  return normalizePrefs(data[PREFS_KEY])
}

/** Saves the supplied preferences alongside the current settings. */
export function savePrefs(prefs: Partial<ReaderPreferences>): Promise<void> {
  // The engine and voice controls can change before the first write finishes.
  const write = pendingWrite.then(async () => {
    const current = await loadPrefs()
    await browser.storage.local.set({ [PREFS_KEY]: { ...current, ...prefs } })
  })
  pendingWrite = write.catch(() => {})
  return write
}

/**
 * Writes `engine` only when none is stored yet. Fresh installs seed Pocket.
 * Updates keep the system voice for profiles that predate engine selection.
 */
export async function seedEngine(engine: ReaderEngine) {
  const data = await browser.storage.local.get(PREFS_KEY)
  const stored = data[PREFS_KEY] as Partial<ReaderPreferences> | undefined
  if (!stored?.engine) await savePrefs({ engine })
}

/** Subscribes to normalized changes to the reader preferences. */
export function onPrefsChanged(callback: (prefs: ReaderPreferences) => void) {
  const handler = (changes: Record<string, { newValue?: unknown }>) => {
    if (PREFS_KEY in changes) {
      callback(normalizePrefs(changes[PREFS_KEY]?.newValue))
    }
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}

function clampSpeed(speed: unknown) {
  if (typeof speed !== "number" || !Number.isFinite(speed)) return DEFAULT_PREFS.speed
  return Math.min(SPEED.max, Math.max(SPEED.min, speed))
}
