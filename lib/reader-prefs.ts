export type ReaderEngine = "system" | "supertonic"

export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] as const
export type ReaderSpeed = (typeof SPEEDS)[number]

export interface ReaderPreferences {
  engine: ReaderEngine
  speed: ReaderSpeed
  voiceURI: string | null
}

const PREFS_KEY = "orateur:reader-prefs"
const DEFAULT_PREFS: ReaderPreferences = {
  engine: "system",
  speed: 1,
  voiceURI: null,
}

export async function loadPrefs(): Promise<ReaderPreferences> {
  const data = await browser.storage.local.get(PREFS_KEY)
  const stored = data[PREFS_KEY] as Partial<ReaderPreferences> | undefined
  return { ...DEFAULT_PREFS, ...stored }
}

export function savePrefs(prefs: Partial<ReaderPreferences>) {
  return browser.storage.local.get(PREFS_KEY).then((data) => {
    const stored = data[PREFS_KEY] as Partial<ReaderPreferences> | undefined
    const current = stored ? { ...DEFAULT_PREFS, ...stored } : DEFAULT_PREFS
    browser.storage.local.set({
      [PREFS_KEY]: { ...current, ...prefs },
    })
  })
}

export function onPrefsChanged(callback: (prefs: ReaderPreferences) => void) {
  const handler = (changes: Record<string, any>) => {
    if (PREFS_KEY in changes) {
      const newVal = changes[PREFS_KEY].newValue as Partial<ReaderPreferences> | undefined
      callback(newVal ? { ...DEFAULT_PREFS, ...newVal } : DEFAULT_PREFS)
    }
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}
