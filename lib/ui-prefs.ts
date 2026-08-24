// lib/ui-prefs.ts
//
// Réglages d'interface (thème, langue) de la page d'options — et du futur
// popup (jalon 4c). Séparé de reader-prefs.ts : ce ne sont pas des réglages
// de lecture, et reader-prefs.ts est chargé par reader.content.ts sur
// `<all_urls>`, où il doit rester ce qu'il est.

export type ColorTheme = "system" | "light" | "dark"
export type UiLanguage = "auto" | "fr" | "en"

export interface UiPreferences {
  theme: ColorTheme
  language: UiLanguage
}

const PREFS_KEY = "orateur:ui-prefs"
const DEFAULT_PREFS: UiPreferences = {
  theme: "system",
  language: "auto",
}

const THEMES: ColorTheme[] = ["system", "light", "dark"]
const LANGUAGES: UiLanguage[] = ["auto", "fr", "en"]

// Le storage n'est pas une source sûre : une version précédente de
// l'extension ou une édition manuelle peut y laisser une valeur que ces
// types n'admettent plus.
function sanitize(prefs: Partial<UiPreferences> | undefined): UiPreferences {
  const theme = prefs?.theme
  const language = prefs?.language
  return {
    theme: THEMES.includes(theme as ColorTheme) ? (theme as ColorTheme) : DEFAULT_PREFS.theme,
    language: LANGUAGES.includes(language as UiLanguage) ? (language as UiLanguage) : DEFAULT_PREFS.language,
  }
}

export async function loadUiPrefs(): Promise<UiPreferences> {
  const data = await browser.storage.local.get(PREFS_KEY)
  return sanitize(data[PREFS_KEY] as Partial<UiPreferences> | undefined)
}

export async function saveUiPrefs(prefs: Partial<UiPreferences>) {
  // Le `set` doit être attendu : sans ça deux réglages cliqués coup sur coup
  // relisent tous les deux l'état d'avant, et le second écrase le premier.
  const current = await loadUiPrefs()
  await browser.storage.local.set({ [PREFS_KEY]: sanitize({ ...current, ...prefs }) })
}

export function onUiPrefsChanged(callback: (prefs: UiPreferences) => void) {
  const handler = (changes: Record<string, any>) => {
    if (PREFS_KEY in changes) {
      callback(sanitize(changes[PREFS_KEY].newValue as Partial<UiPreferences> | undefined))
    }
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}
