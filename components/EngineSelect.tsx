import { useTranslation } from "../hooks/useTranslation"
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
}

/**
 * Deux cartes radio plutôt qu'un `<select>` : chaque moteur porte son
 * libellé et sa contrepartie, au lieu d'un choix à l'aveugle dans une liste
 * déroulante. Vrais `<input type="radio">` dans un `role="radiogroup"` pour
 * que les flèches du clavier naviguent nativement.
 */
export function EngineSelect({ value, onChange, modelCached }: EngineSelectProps) {
  const t = useTranslation()

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
        <div className="engine-alert" role="status">
          {modelCached ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
          <p>
            <strong>{t(modelCached ? "optionsModelAlertReadyLead" : "optionsModelAlertPendingLead")}</strong>
            {t(modelCached ? "optionsModelAlertReady" : "optionsModelAlertPending")}
          </p>
        </div>
      )}
    </div>
  )
}
