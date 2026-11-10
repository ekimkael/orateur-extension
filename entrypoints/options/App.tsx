/**
 * Première page React du dépôt (jalon 1b). Confinement volontaire : React ne
 * vit ici et dans le futur popup (jalon 4c), jamais dans un content script —
 * reader.content/ et selection.content.ts tournent sur `<all_urls>` et
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
import { PronunciationSettings } from "../../components/PronunciationSettings"
import { getSettingsSection, HeartIcon, SettingsNav } from "./SettingsNav"
import { clearModelCache, getModelCacheSize } from "../../lib/supertonic/model-cache.ts"
import { clearPocketModelCache, getPocketModelCacheSize } from "../../lib/pocket/model-cache.ts"
import { toMegabytes } from "../../lib/storage-size.ts"
import { resolveLocale } from "../../lib/i18n"
import { applyTheme } from "../../lib/theme"
import { ORATEUR_ORIGIN } from "../../lib/handoff"
import { SUPPORT_URL } from "../../lib/reading-outro"
import { track } from "../../lib/telemetry"
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

type CacheEngine = "supertonic" | "pocket"

function AppContent({ prefs, updatePrefs, uiPrefs, updateUiPrefs }: AppContentProps) {
  const t = useTranslation()
  const [activeSection, setActiveSection] = useState(getSettingsSection)
  const { consent, setEnabled: setTelemetryEnabled } = useTelemetryConsent()
  const locale = resolveLocale(uiPrefs.language)

  const { sites: hiddenSites, add: addSite, remove: removeSite } = useHiddenSites()
  const [siteInput, setSiteInput] = useState("")
  const [siteInvalid, setSiteInvalid] = useState(false)
  const siteInputRef = useRef<HTMLInputElement>(null)

  const [cacheBytes, setCacheBytes] = useState<Record<CacheEngine, number | null>>({ supertonic: null, pocket: null })
  const [clearing, setClearing] = useState<CacheEngine | null>(null)
  const [armed, setArmed] = useState<CacheEngine | null>(null)
  const [cacheError, setCacheError] = useState<CacheEngine | null>(null)
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function navigate() {
      setActiveSection(getSettingsSection())
    }
    window.addEventListener("hashchange", navigate)
    return () => window.removeEventListener("hashchange", navigate)
  }, [])

  useEffect(() => {
    document.querySelector<HTMLElement>(`#${activeSection} h2`)?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: "instant" })
    setArmed(null)
    if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
  }, [activeSection])

  useEffect(() => {
    if (activeSection === "modele" || activeSection === "voix" || activeSection === "prononciation") void refreshCacheSize()
  }, [activeSection])

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
    const [supertonic, pocket] = await Promise.all([getModelCacheSize(), getPocketModelCacheSize()])
    setCacheBytes({ supertonic, pocket })
  }

  async function handleClearCache(engine: CacheEngine) {
    setClearing(engine)
    setCacheError(null)
    try {
      await (engine === "pocket" ? clearPocketModelCache() : clearModelCache())
      await refreshCacheSize()
    } catch {
      setCacheError(engine)
    } finally {
      setClearing(null)
    }
  }

  function handleClearClick(engine: CacheEngine) {
    if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
    if (armed === engine) {
      setArmed(null)
      void handleClearCache(engine)
      return
    }
    setArmed(engine)
    armedTimerRef.current = setTimeout(() => setArmed(null), 4000)
  }

  const modelCached = cacheBytes.supertonic != null

  return (
    <main className="page">
      <div className="brand">
        <img src={browser.runtime.getURL("/icon/32.png")} alt="" />
        <span>{browser.i18n.getMessage("extName")}</span>
      </div>

      <h1>{t("optionsHeading")}</h1>
      <p className="tagline">{t("optionsTagline")}</p>

      <div className="shell">
        <SettingsNav activeSection={activeSection} />

        <div className="card options-card">
          <section className="section" id="general" hidden={activeSection !== "general"} aria-labelledby="general-heading">
            <h2 className="eyebrow" id="general-heading" tabIndex={-1}>{t("optionsSectionGeneral")}</h2>

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

          <section className="section" id="sites" hidden={activeSection !== "sites"} aria-labelledby="sites-heading">
            <h2 className="eyebrow" id="sites-heading" tabIndex={-1}>{t("optionsSectionSites")}</h2>
            <p className="help">{t("optionsSitesHelp")}</p>

            <label className="row-label site-add-label" htmlFor="site-input">
              {t("optionsSitesLabel")}
            </label>
            <form
              className="site-add"
              onSubmit={(e) => {
                e.preventDefault()
                if (!normalizeSite(siteInput)) {
                  setSiteInvalid(true)
                  siteInputRef.current?.focus()
                  return
                }
                addSite(siteInput)
                setSiteInput("")
              }}
            >
              <input
                id="site-input"
                ref={siteInputRef}
                type="text"
                aria-invalid={siteInvalid || undefined}
                aria-describedby="site-input-hint"
                value={siteInput}
                onChange={(e) => {
                  setSiteInput(e.target.value)
                  setSiteInvalid(false)
                }}
                placeholder={t("optionsSitesPlaceholder")}
              />
              <button type="submit">
                {t("optionsSitesAdd")}
              </button>
            </form>
            <p id="site-input-hint" className="help" role={siteInvalid ? "alert" : undefined}>
              {t(siteInvalid ? "optionsSitesInvalid" : "optionsSitesHint")}
            </p>

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

          <section className="section" id="voix" hidden={activeSection !== "voix"} aria-labelledby="voix-heading">
            <h2 className="eyebrow" id="voix-heading" tabIndex={-1}>{t("optionsSectionVoice")}</h2>

            <EngineSelect
              value={prefs.engine}
              onChange={(engine) => updatePrefs({ engine })}
              modelCached={modelCached}
              onModelDownloaded={refreshCacheSize}
              locale={locale}
            />

            {activeSection === "voix" && (
              <VoicePicker
                engine={prefs.engine}
                voiceURI={prefs.voiceURI}
                supertonicVoice={prefs.supertonicVoice}
                pocketVoice={prefs.pocketVoice}
                speed={prefs.speed}
                onChangeSystemVoice={(voiceURI) => updatePrefs({ voiceURI })}
                onChangeSupertonicVoice={(supertonicVoice) => updatePrefs({ supertonicVoice })}
                onChangePocketVoice={(pocketVoice) => updatePrefs({ pocketVoice })}
              />
            )}

            <SpeedSlider value={prefs.speed} onChange={(speed) => updatePrefs({ speed })} locale={locale} />
          </section>

          <PronunciationSettings prefs={prefs} modelCached={modelCached} active={activeSection === "prononciation"} />

          <section className="section" id="modele" hidden={activeSection !== "modele"} aria-labelledby="modele-heading">
            <h2 className="eyebrow" id="modele-heading" tabIndex={-1}>{t("optionsSectionModel")}</h2>

            {(["pocket", "supertonic"] as const).map((engine) => {
              const bytes = cacheBytes[engine]
              const cacheMb = bytes ? String(Math.max(1, toMegabytes(bytes))) : null
              return (
                <div className="row" key={engine} role="group" aria-labelledby={`cache-${engine}`}>
                  <span className="row-label" id={`cache-${engine}`}>{t(engine === "pocket" ? "enginePocket" : "engineNaturalAI")}</span>
                  {cacheMb ? (
                    <div className="cache-body">
                      <p className="cache-note">{t(engine === "pocket" ? "optionsPocketCacheSize" : "optionsCacheSize", [cacheMb])}</p>
                      <div className="cache-actions" aria-live="polite" aria-atomic="true">
                        <button
                          type="button"
                          className="btn-danger"
                          data-armed={armed === engine}
                          onClick={() => handleClearClick(engine)}
                          disabled={clearing !== null}
                        >
                          {clearing === engine
                            ? t("optionsClearingCache")
                            : armed === engine
                              ? t("optionsClearCacheConfirm")
                              : t("optionsClearCache", [cacheMb])}
                        </button>
                        {armed === engine && <span className="cache-hint">{t("optionsClearCacheHint")}</span>}
                      </div>
                      {cacheError === engine && <p className="cache-note" role="alert">{t("optionsClearCacheError")}</p>}
                    </div>
                  ) : (
                    <p className="cache-note">{t("optionsModelEmpty")}</p>
                  )}
                </div>
              )
            })}
            <p className="cache-note"><a href="#voix">{t("optionsModelGoToVoice")}</a></p>
          </section>

          <section className="section" id="confidentialite" hidden={activeSection !== "confidentialite"} aria-labelledby="confidentialite-heading">
            <h2 className="eyebrow" id="confidentialite-heading" tabIndex={-1}>{t("optionsSectionPrivacy")}</h2>

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

          <section className="section" id="soutien" hidden={activeSection !== "soutien"} aria-labelledby="soutien-heading">
            <h2 className="eyebrow" id="soutien-heading" tabIndex={-1}>{t("optionsSupportTitle")}</h2>
            <p className="privacy-desc">{t("optionsSupportDescription")}</p>
            <a
              className="btn-primary support-cta"
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track({ name: "support_cta_clicked", properties: { source: "options_section" } })}
            >
              <HeartIcon />
              {t("optionsSupportCta")}
            </a>
          </section>
        </div>
      </div>

      <div className="foot">
        <span className="foot-links">
          <a href={ORATEUR_ORIGIN} target="_blank" rel="noopener">
            {t("optionsOpenApp")}
          </a>
          <a
            className="foot-support"
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track({ name: "support_cta_clicked", properties: { source: "options_footer" } })}
          >
            <HeartIcon />
            {t("readerSupportCta")}
          </a>
        </span>
        <span className="version">v{browser.runtime.getManifest().version}</span>
      </div>
    </main>
  )
}

