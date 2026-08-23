import { useEffect, useState } from "react"
import {
  loadPrefs,
  savePrefs,
  onPrefsChanged,
  type ReaderPreferences,
} from "../lib/reader-prefs"

/**
 * Pont React vers lib/reader-prefs.ts, partagé par la page d'options et le
 * popup (jalon 4c) — ne réimplémente rien, juste un état synchronisé sur
 * loadPrefs()/onPrefsChanged(), qui restent la seule source de vérité.
 *
 * `updatePrefs` fusionne en local avant que l'aller-retour storage ne
 * confirme : même choix que la pastille (reader.content.ts, `currentPrefs`
 * sur changement de moteur) pour qu'un curseur ne traîne pas derrière le doigt.
 */
export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPreferences | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadPrefs().then((loaded) => {
      if (!cancelled) setPrefs(loaded)
    })
    const unsubscribe = onPrefsChanged((updated) => {
      if (!cancelled) setPrefs(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function updatePrefs(patch: Partial<ReaderPreferences>) {
    setPrefs((current) => (current ? { ...current, ...patch } : current))
    void savePrefs(patch)
  }

  return { prefs, updatePrefs }
}
