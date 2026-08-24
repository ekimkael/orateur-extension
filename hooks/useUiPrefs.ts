import { useEffect, useState } from "react"
import { loadUiPrefs, saveUiPrefs, onUiPrefsChanged, type UiPreferences } from "../lib/ui-prefs"

/** Même forme que useReaderPrefs.ts : lib/ui-prefs.ts reste la seule source de vérité. */
export function useUiPrefs() {
  const [prefs, setPrefs] = useState<UiPreferences | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadUiPrefs().then((loaded) => {
      if (!cancelled) setPrefs(loaded)
    })
    const unsubscribe = onUiPrefsChanged((updated) => {
      if (!cancelled) setPrefs(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function updatePrefs(patch: Partial<UiPreferences>) {
    setPrefs((current) => (current ? { ...current, ...patch } : current))
    void saveUiPrefs(patch)
  }

  return { prefs, updatePrefs }
}
