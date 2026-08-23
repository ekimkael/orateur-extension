import type { ReaderEngine } from "../lib/reader-prefs"

interface EngineSelectProps {
  value: ReaderEngine
  onChange: (engine: ReaderEngine) => void
}

export function EngineSelect({ value, onChange }: EngineSelectProps) {
  // Résolu dans le corps du composant, pas en haut du module : WXT exécute
  // certains entrypoints sous un faux `browser` (sans `i18n`) pour en lire la
  // config au build — voir la note sur browser.i18n dans reader.content.ts.
  const engines: Array<[ReaderEngine, string]> = [
    ["system", browser.i18n.getMessage("engineSystem")],
    // Nom de marque, identique dans toutes les locales : rien à traduire.
    ["supertonic", "Supertonic"],
  ]

  return (
    <label className="settings-row">
      <span className="settings-label">{browser.i18n.getMessage("settingsEngineLabel")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as ReaderEngine)}>
        {engines.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
