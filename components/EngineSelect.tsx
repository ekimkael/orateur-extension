import { useTranslation } from "../hooks/useTranslation"
import { useModelDownload } from "../hooks/useModelDownload"
import type { Locale } from "../lib/i18n"
import type { ReaderEngine } from "../lib/reader-prefs"

interface EngineSelectProps {
  value: ReaderEngine
  onChange: (engine: ReaderEngine) => void
  /**
   * `cacheBytes != null` côté App.tsx — même simplification que l'ancien
   * code : le court instant entre "pas encore vérifié" et "confirmé vide"
   * n'a jamais été distingué, `getModelCacheSize()` ne le permet pas.
   */
  modelCached: boolean
  /** Rafraîchit `cacheBytes` côté App.tsx à la fin d'un téléchargement — seul
   *  ce composant sait quand ça se termine, seul App.tsx sait relire la taille. */
  onModelDownloaded: () => void
  locale: Locale
}

function formatMb(bytes: number, locale: Locale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(bytes / (1024 * 1024)))
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
)

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
)

/**
 * Deux cartes radio plutôt qu'un `<select>` : chaque moteur porte son
 * libellé et sa contrepartie, au lieu d'un choix à l'aveugle dans une liste
 * déroulante. Vrais `<input type="radio">` dans un `role="radiogroup"` pour
 * que les flèches du clavier naviguent nativement.
 */
export function EngineSelect({ value, onChange, modelCached, onModelDownloaded, locale }: EngineSelectProps) {
  const t = useTranslation()
  const download = useModelDownload(onModelDownloaded)

  return (
    <div>
      <div className="engine-grid" role="radiogroup" aria-label={t("settingsEngineLabel")}>
        <label className="engine-card">
          <input
            type="radio"
            name="engine"
            value="system"
            checked={value === "system"}
            onChange={() => onChange("system")}
          />
          <span className="engine-head">
            <span className="engine-title">{t("engineSystem")}</span>
            <span className="radio" aria-hidden="true" />
          </span>
          <span className="engine-desc">{t("engineSystemDesc")}</span>
        </label>

        <label className="engine-card">
          <input
            type="radio"
            name="engine"
            value="supertonic"
            checked={value === "supertonic"}
            onChange={() => onChange("supertonic")}
          />
          <span className="engine-head">
            <span className="engine-title">{t("engineNaturalAI")}</span>
            <span className="radio" aria-hidden="true" />
          </span>
          <span className="engine-desc">{t("engineNaturalAIDesc")}</span>
        </label>
      </div>

      {value === "supertonic" && (
        <>
          {download.phase === "unavailable" ? (
            <div className="engine-alert" role="status">
              <InfoIcon />
              <p>{t("optionsModelUnavailable")}</p>
            </div>
          ) : download.phase === "downloading" ? (
            <div className="engine-alert" role="status">
              <InfoIcon />
              <div className="engine-alert-body">
                <p>
                  <strong>
                    {t("optionsModelDownloading", [formatMb(download.loaded, locale), formatMb(download.total, locale)])}
                  </strong>
                </p>
                <progress
                  max={download.total || 1}
                  value={download.loaded}
                  aria-label={t("optionsModelDownloading", [formatMb(download.loaded, locale), formatMb(download.total, locale)])}
                />
                <p className="cache-note">{t("optionsModelDownloadingNote")}</p>
                <button type="button" className="btn-text" onClick={download.cancel}>
                  {t("optionsModelCancel")}
                </button>
              </div>
            </div>
          ) : download.phase === "error" ? (
            <div className="engine-alert" role="alert">
              <AlertIcon />
              <div className="engine-alert-body">
                <p>{t("optionsModelError")}</p>
                <button type="button" className="btn-text" onClick={download.retry}>
                  {t("optionsModelRetry")}
                </button>
              </div>
            </div>
          ) : modelCached ? (
            <div className="engine-alert" role="status">
              <CheckIcon />
              <p>
                <strong>{t("optionsModelAlertReadyLead")}</strong>
                {t("optionsModelAlertReady")}
              </p>
            </div>
          ) : (
            <div className="engine-alert" role="status">
              <InfoIcon />
              <div className="engine-alert-body">
                <p>
                  <strong>{t("optionsModelAlertPendingLead")}</strong>
                  {t("optionsModelAlertPending")}
                </p>
                <button type="button" className="btn-primary" onClick={download.start}>
                  {t("optionsModelDownloadCta")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
