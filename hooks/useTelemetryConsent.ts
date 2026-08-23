import { useEffect, useState } from "react"
import {
  loadTelemetryConsent,
  setTelemetryEnabled,
  onTelemetryConsentChanged,
  type TelemetryConsent,
} from "../lib/telemetry"

/** Même forme que useReaderPrefs.ts : lib/telemetry.ts reste la seule source de vérité. */
export function useTelemetryConsent() {
  const [consent, setConsent] = useState<TelemetryConsent | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadTelemetryConsent().then((loaded) => {
      if (!cancelled) setConsent(loaded)
    })
    const unsubscribe = onTelemetryConsentChanged((updated) => {
      if (!cancelled) setConsent(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function setEnabled(enabled: boolean) {
    // Pas de fusion optimiste ici : setTelemetryEnabled() décide elle-même du
    // distinctId (créé ou effacé), onTelemetryConsentChanged confirme dans la
    // foulée — la checkbox reste réactive sans qu'on ait à deviner l'id ici.
    void setTelemetryEnabled(enabled)
  }

  return { consent, setEnabled }
}
