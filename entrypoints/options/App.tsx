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
import { useHiddenSites } from "../../hooks/useHiddenSites"
import { useTelemetryConsent } from "../../hooks/useTelemetryConsent"
import { TranslationProvider, useTranslation } from "../../hooks/useTranslation"
import { EngineSelect } from "../../components/EngineSelect"
import { SpeedSlider } from "../../components/SpeedSlider"
import { VoicePicker } from "../../components/VoicePicker"
import { ThemeSegmented } from "../../components/ThemeSegmented"
import { PositionSegmented } from "../../components/PositionSegmented"
import { SettingsNav } from "./SettingsNav"
import { clearModelCache, getModelCacheSize } from "../../lib/supertonic/model-cache.ts"
import { resolveLocale } from "../../lib/i18n"
import { applyTheme } from "../../lib/theme"
import { ORATEUR_ORIGIN } from "../../lib/handoff"
import { normalizeSite } from "../../lib/site-rules"
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

  const { sites: hiddenSites, add: addSite, remove: removeSite } = useHiddenSites()
  const [siteInput, setSiteInput] = useState("")

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
            <h2 className="eyebrow">{t("optionsSectionGeneral")}</h2>

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

            <div className="row">
              <span className="row-head">
                <span className="row-label">{t("optionsPositionLabel")}</span>
              </span>
              <PositionSegmented value={prefs.position} onChange={(position) => updatePrefs({ position })} />
              <p className="help">{t("optionsPositionHelp")}</p>
            </div>
          </section>

          <section className="section" id="sites">
            <h2 className="eyebrow">{t("optionsSectionSites")}</h2>
            <p className="help">{t("optionsSitesHelp")}</p>

            <label className="row-label site-add-label" htmlFor="site-input">
              {t("optionsSitesLabel")}
            </label>
            <form
              className="site-add"
              onSubmit={(e) => {
                e.preventDefault()
                if (!normalizeSite(siteInput)) return
                addSite(siteInput)
                setSiteInput("")
              }}
            >
              <input
                id="site-input"
                type="text"
                value={siteInput}
                onChange={(e) => setSiteInput(e.target.value)}
                placeholder={t("optionsSitesPlaceholder")}
              />
              <button type="submit" disabled={!normalizeSite(siteInput)}>
                {t("optionsSitesAdd")}
              </button>
            </form>

            {hiddenSites.length > 0 ? (
              <ul className="site-list">
                {hiddenSites.map((site) => (
                  <li key={site} className="site-item">
                    <span>{site}</span>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={t("ariaRemoveSite", [site])}
                      onClick={() => removeSite(site)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="help">{t("optionsSitesEmpty")}</p>
            )}
          </section>

          <section className="section" id="voix">
            <h2 className="eyebrow">{t("optionsSectionVoice")}</h2>

            <EngineSelect
              value={prefs.engine}
              onChange={(engine) => updatePrefs({ engine })}
              modelCached={modelCached}
              onModelDownloaded={refreshCacheSize}
              locale={locale}
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
            <h2 className="eyebrow">{t("optionsSectionModel")}</h2>

            {cacheBytes != null ? (
              // Pas de <progress> ici : une barre toujours à 100% est de la
              // décoration, pas un état — le texte suffit.
              <div className="cache-body">
                <p className="cache-note">{t("optionsCacheSize", [String(cacheMb)])}</p>
                <div className="cache-actions" aria-live="polite" aria-atomic="true">
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
              // Cul-de-sac évité : un seul CTA de téléchargement dans toute la
              // page (section Voix) — cette section-ci n'y renvoie, sans en
              // dupliquer un second.
              <div className="cache-body">
                <p className="cache-note">{t("optionsModelEmpty")}</p>
                <p className="cache-note">
                  <a href="#voix">{t("optionsModelGoToVoice")}</a>
                </p>
              </div>
            )}
          </section>

          <section className="section" id="confidentialite">
            <h2 className="eyebrow">{t("optionsSectionPrivacy")}</h2>

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
