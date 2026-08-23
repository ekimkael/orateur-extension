/**
 * Première page React du dépôt (jalon 1b). Confinement volontaire : React ne
 * vit ici et dans le futur popup (jalon 4c), jamais dans un content script —
 * reader.content.ts et selection.content.ts tournent sur `<all_urls>` et
 * doivent rester vanilla et légers, comme le documente déjà tts-messages.ts
 * pour empêcher le moteur Supertonic de fuir dans leur bundle.
 */
import { useEffect, useState } from "react"
import { useReaderPrefs } from "../../hooks/useReaderPrefs"
import { useTelemetryConsent } from "../../hooks/useTelemetryConsent"
import { EngineSelect } from "../../components/EngineSelect"
import { SpeedSlider } from "../../components/SpeedSlider"
import { VoicePicker } from "../../components/VoicePicker"
import { clearModelCache, getModelCacheSize } from "../../lib/supertonic/model-cache.ts"

export function App() {
  const { prefs, updatePrefs } = useReaderPrefs()
  const { consent, setEnabled: setTelemetryEnabled } = useTelemetryConsent()
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    void refreshCacheSize()
    // `__MSG_*__` ne se résout que dans manifest.json — le titre et le `lang`
    // localisés de cette page se posent donc ici, pas dans index.html.
    document.title = browser.i18n.getMessage("optionsTitle")
    document.documentElement.lang = browser.i18n.getUILanguage()
  }, [])

  async function refreshCacheSize() {
    setCacheBytes(await getModelCacheSize())
  }

  async function handleClearCache() {
    setClearing(true)
    try {
      await clearModelCache()
      await refreshCacheSize()
    } finally {
      setClearing(false)
    }
  }

  // Premier rendu, avant que loadPrefs() ne résolve — quelques millisecondes,
  // pas la peine d'un squelette de chargement pour ça.
  if (!prefs) return null

  return (
    <main>
      <h1>{browser.i18n.getMessage("extName")}</h1>

      <EngineSelect value={prefs.engine} onChange={(engine) => updatePrefs({ engine })} />
      <SpeedSlider value={prefs.speed} onChange={(speed) => updatePrefs({ speed })} />
      <VoicePicker
        engine={prefs.engine}
        voiceURI={prefs.voiceURI}
        supertonicVoice={prefs.supertonicVoice}
        onChangeSystemVoice={(voiceURI) => updatePrefs({ voiceURI })}
        onChangeSupertonicVoice={(supertonicVoice) => updatePrefs({ supertonicVoice })}
      />

      {prefs.engine === "supertonic" && (
        <section className="cache-section">
          <p>{browser.i18n.getMessage("supertonicNoteLead")}</p>
          {cacheBytes != null ? (
            <>
              <p>{browser.i18n.getMessage("optionsCacheSize", [String(Math.round(cacheBytes / (1024 * 1024)))])}</p>
              <button type="button" onClick={() => void handleClearCache()} disabled={clearing}>
                {browser.i18n.getMessage(clearing ? "optionsClearingCache" : "optionsClearCache")}
              </button>
            </>
          ) : (
            <p>{browser.i18n.getMessage("supertonicNoteSize")}</p>
          )}
        </section>
      )}

      <section className="telemetry-section">
        <h2>{browser.i18n.getMessage("optionsTelemetryHeading")}</h2>
        <p>{browser.i18n.getMessage("optionsTelemetryDescription")}</p>
        <label className="telemetry-toggle">
          <input
            type="checkbox"
            checked={consent?.enabled ?? false}
            onChange={(e) => setTelemetryEnabled(e.target.checked)}
          />
          <span>{browser.i18n.getMessage("optionsTelemetryEnable")}</span>
        </label>
      </section>
    </main>
  )
}
