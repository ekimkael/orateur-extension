/**
 * Première page React du dépôt (jalon 1b). Confinement volontaire : React ne
 * vit ici et dans le futur popup (jalon 4c), jamais dans un content script —
 * reader.content.ts et selection.content.ts tournent sur `<all_urls>` et
 * doivent rester vanilla et légers, comme le documente déjà tts-messages.ts
 * pour empêcher le moteur Supertonic de fuir dans leur bundle.
 */
import { useEffect, useRef, useState } from "react"
import { useReaderPrefs } from "../../hooks/useReaderPrefs"
import { useUiPrefs } from "../../hooks/useUiPrefs"
import { useTelemetryConsent } from "../../hooks/useTelemetryConsent"
import { TranslationProvider, useTranslation } from "../../hooks/useTranslation"
import { EngineSelect } from "../../components/EngineSelect"
import { SpeedSlider } from "../../components/SpeedSlider"
import { VoicePicker } from "../../components/VoicePicker"
import { ThemeSegmented } from "../../components/ThemeSegmented"
import { SettingsNav } from "./SettingsNav"
import { clearModelCache, getModelCacheSize } from "../../lib/supertonic/model-cache.ts"
import { resolveLocale } from "../../lib/i18n"
import { applyTheme } from "../../lib/theme"
import { ORATEUR_ORIGIN } from "../../lib/handoff"
import type { UiLanguage } from "../../lib/ui-prefs"

export function App() {
  const { prefs, updatePrefs } = useReaderPrefs()
  const { prefs: uiPrefs, updatePrefs: updateUiPrefs } = useUiPrefs()

  // Premier rendu, avant que loadPrefs()/loadUiPrefs() ne résolvent —
  // quelques millisecondes, pas la peine d'un squelette de chargement.
  if (!prefs || !uiPrefs) return null

  return (
    <TranslationProvider language={uiPrefs.language}>
      <AppContent prefs={prefs} updatePrefs={updatePrefs} uiPrefs={uiPrefs} updateUiPrefs={updateUiPrefs} />
    </TranslationProvider>
  )
}

interface AppContentProps {
  prefs: NonNullable<ReturnType<typeof useReaderPrefs>["prefs"]>
  updatePrefs: ReturnType<typeof useReaderPrefs>["updatePrefs"]
  uiPrefs: NonNullable<ReturnType<typeof useUiPrefs>["prefs"]>
  updateUiPrefs: ReturnType<typeof useUiPrefs>["updatePrefs"]
}

function AppContent({ prefs, updatePrefs, uiPrefs, updateUiPrefs }: AppContentProps) {
  const t = useTranslation()
  const { consent, setEnabled: setTelemetryEnabled } = useTelemetryConsent()
  const locale = resolveLocale(uiPrefs.language)

  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)
  const [armed, setArmed] = useState(false)
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void refreshCacheSize()
  }, [])

  // `__MSG_*__` ne se résout que dans manifest.json — le titre et le `lang`
  // localisés de cette page se posent donc ici, avec la locale résolue par
  // l'utilisateur (section Générale), pas celle du navigateur.
  useEffect(() => {
    document.title = t("optionsTitle")
    document.documentElement.lang = locale
  }, [locale])

  // main.tsx pose l'attribut avant le premier rendu pour éviter le flash ;
  // cet effet le garde synchronisé sur les changements ultérieurs — un
  // nouveau choix ici, ou onUiPrefsChanged depuis un autre onglet réglages.
  useEffect(() => {
    applyTheme(uiPrefs.theme)
  }, [uiPrefs.theme])

  useEffect(() => {
    return () => {
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
    }
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

  function handleClearClick() {
    if (armed) {
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
      setArmed(false)
      void handleClearCache()
      return
    }
    setArmed(true)
    armedTimerRef.current = setTimeout(() => setArmed(false), 4000)
  }

  const modelCached = cacheBytes != null
  const cacheMb = cacheBytes != null ? Math.round(cacheBytes / (1024 * 1024)) : null

  return (
    <main className="page">
      <div className="brand">
        <img src={browser.runtime.getURL("/icon/32.png")} alt="" />
        <span>{browser.i18n.getMessage("extName")}</span>
      </div>

      <h1>{t("optionsHeading")}</h1>
      <p className="tagline">{t("optionsTagline")}</p>

      <div className="shell">
        <SettingsNav />

        <div className="card">
          <section className="section" id="general">
            <p className="eyebrow">{t("optionsSectionGeneral")}</p>

            <div className="row">
              <span className="row-head">
                <span className="row-label">{t("optionsThemeLabel")}</span>
              </span>
              <ThemeSegmented value={uiPrefs.theme} onChange={(theme) => updateUiPrefs({ theme })} />
              <p className="help">{t("optionsThemeHelp")}</p>
            </div>

            <label className="row">
              <span className="row-head">
                <span className="row-label">{t("optionsLanguageLabel")}</span>
              </span>
              <select
                value={uiPrefs.language}
                onChange={(e) => updateUiPrefs({ language: e.target.value as UiLanguage })}
              >
                <option value="auto">{t("optionsLanguageAuto")}</option>
                {/* Noms natifs, jamais traduits — comme "Supertonic" : un
                    francophone doit reconnaître "Français" même si l'UI
                    affichée est en anglais. */}
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
              <p className="help">{t("optionsLanguageHelp")}</p>
            </label>

            <div className="row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={prefs.follow}
                  onChange={(e) => updatePrefs({ follow: e.target.checked })}
                />
                <span className="toggle-text">{t("optionsFollowLabel")}</span>
              </label>
              <p className="help">{t("optionsFollowHelp")}</p>
            </div>
          </section>

          <section className="section" id="voix">
            <p className="eyebrow">{t("optionsSectionVoice")}</p>

            <EngineSelect
              value={prefs.engine}
              onChange={(engine) => updatePrefs({ engine })}
              modelCached={modelCached}
            />

            <VoicePicker
              engine={prefs.engine}
              voiceURI={prefs.voiceURI}
              supertonicVoice={prefs.supertonicVoice}
              speed={prefs.speed}
              onChangeSystemVoice={(voiceURI) => updatePrefs({ voiceURI })}
              onChangeSupertonicVoice={(supertonicVoice) => updatePrefs({ supertonicVoice })}
            />

            <SpeedSlider value={prefs.speed} onChange={(speed) => updatePrefs({ speed })} locale={locale} />
          </section>

          <section className="section" id="modele">
            <p className="eyebrow">{t("optionsSectionModel")}</p>

            {cacheBytes != null ? (
              <div className="cache-body">
                <progress max={cacheBytes} value={cacheBytes}></progress>
                <p className="cache-note">{t("optionsCacheSize", [String(cacheMb)])}</p>
                <div className="cache-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    data-armed={armed}
                    onClick={handleClearClick}
                    disabled={clearing}
                  >
                    {clearing
                      ? t("optionsClearingCache")
                      : armed
                        ? t("optionsClearCacheConfirm")
                        : t("optionsClearCache", [String(cacheMb)])}
                  </button>
                  {armed && <span className="cache-hint">{t("optionsClearCacheHint")}</span>}
                </div>
              </div>
            ) : (
              <div className="cache-body">
                <p className="cache-note">{t("optionsModelEmpty")}</p>
              </div>
            )}
          </section>

          <section className="section" id="confidentialite">
            <p className="eyebrow">{t("optionsSectionPrivacy")}</p>

            <label className="toggle">
              <input
                type="checkbox"
                checked={consent?.enabled ?? false}
                onChange={(e) => setTelemetryEnabled(e.target.checked)}
              />
              <span className="toggle-text">{t("optionsTelemetryEnable")}</span>
            </label>

            <p className="privacy-desc">{t("optionsTelemetryDescription")}</p>
            <p className="privacy-never">{t("optionsTelemetryNever")}</p>
          </section>
        </div>
      </div>

      <div className="foot">
        <a href={ORATEUR_ORIGIN} target="_blank" rel="noopener">
          {t("optionsOpenApp")}
        </a>
        <span className="version">v{browser.runtime.getManifest().version}</span>
      </div>
    </main>
  )
}
