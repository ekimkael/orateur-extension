import { useTranslation } from "../hooks/useTranslation"
import type { Locale } from "../lib/i18n"
import { SPEED } from "../lib/reader-prefs"

interface SpeedSliderProps {
  value: number
  onChange: (speed: number) => void
  /**
   * Locale résolue de la section Générale — plus la locale du navigateur
   * comme avant : la vitesse doit suivre la langue affichée à l'écran, pas
   * une langue qu'on a peut-être justement changée pour s'en écarter.
   */
  locale: Locale
}

function formatSpeed(speed: number, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(speed)
}

export function SpeedSlider({ value, onChange, locale }: SpeedSliderProps) {
  const t = useTranslation()
  return (
    <label className="row">
      <span className="row-head">
        <span className="row-label">{t("settingsSpeedLabel")}</span>
        <span className="row-value">{formatSpeed(value, locale)}×</span>
      </span>
      <input
        type="range"
        min={SPEED.min}
        max={SPEED.max}
        step={SPEED.step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
      <p className="help">{t("optionsSpeedHelp")}</p>
    </label>
  )
}
