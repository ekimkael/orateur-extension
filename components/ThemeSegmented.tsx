import type { ReactNode } from "react"
import { useTranslation } from "../hooks/useTranslation"
import type { ColorTheme } from "../lib/ui-prefs"

interface ThemeSegmentedProps {
  value: ColorTheme
  onChange: (theme: ColorTheme) => void
}

const OPTIONS: Array<{ id: ColorTheme; labelKey: string }> = [
  { id: "system", labelKey: "optionsThemeSystem" },
  { id: "light", labelKey: "optionsThemeLight" },
  { id: "dark", labelKey: "optionsThemeDark" },
]

const ICONS: Record<ColorTheme, ReactNode> = {
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  ),
}

/**
 * Contrôle segmenté plutôt que les grandes cartes du moteur (EngineSelect) :
 * le thème est un choix sans enjeu et instantanément réversible, répéter le
 * motif « carte » deux fois sur la même page l'aplatirait.
 */
export function ThemeSegmented({ value, onChange }: ThemeSegmentedProps) {
  const t = useTranslation()
  return (
    <div className="segmented" role="radiogroup" aria-label={t("optionsThemeLabel")}>
      {OPTIONS.map(({ id, labelKey }) => (
        <label key={id}>
          <input type="radio" name="theme" value={id} checked={value === id} onChange={() => onChange(id)} />
          <span className="seg">
            {ICONS[id]}
            <span>{t(labelKey)}</span>
          </span>
        </label>
      ))}
    </div>
  )
}
