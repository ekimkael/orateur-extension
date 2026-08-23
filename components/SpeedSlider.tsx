import { SPEED } from "../lib/reader-prefs"

interface SpeedSliderProps {
  value: number
  onChange: (speed: number) => void
}

/**
 * `Intl.NumberFormat(undefined, …)` plutôt que le `toFixed(1).replace(".", ",")`
 * codé en dur de reader.content.ts : cette page est la nouvelle surface
 * anglais-d'abord (jalon 1a), le séparateur décimal doit suivre la locale du
 * navigateur, pas rester figé sur la virgule française.
 */
function formatSpeed(speed: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(speed)
}

export function SpeedSlider({ value, onChange }: SpeedSliderProps) {
  return (
    <label className="settings-row">
      <span className="settings-label">
        {browser.i18n.getMessage("settingsSpeedLabel")}
        <span className="settings-value">{formatSpeed(value)}×</span>
      </span>
      <input
        type="range"
        min={SPEED.min}
        max={SPEED.max}
        step={SPEED.step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  )
}
