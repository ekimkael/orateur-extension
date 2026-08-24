import type { ReactNode } from "react"
import { useTranslation } from "../hooks/useTranslation"
import type { PillPosition } from "../lib/reader-prefs"

interface PositionSegmentedProps {
  value: PillPosition
  onChange: (position: PillPosition) => void
}

const OPTIONS: Array<{ id: PillPosition; labelKey: string }> = [
  { id: "top-left", labelKey: "optionsPositionTopLeft" },
  { id: "top-center", labelKey: "optionsPositionTopCenter" },
  { id: "top-right", labelKey: "optionsPositionTopRight" },
  { id: "bottom-left", labelKey: "optionsPositionBottomLeft" },
  { id: "bottom-center", labelKey: "optionsPositionBottomCenter" },
  { id: "bottom-right", labelKey: "optionsPositionBottomRight" },
]

/** Petit rectangle (l'écran) avec un point dans le coin/centre concerné. */
function dot(top: boolean, x: "left" | "center" | "right"): ReactNode {
  const cx = x === "left" ? 5 : x === "right" ? 19 : 12
  const cy = top ? 5 : 19
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="3" />
      <circle cx={cx} cy={cy} r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

const ICONS: Record<PillPosition, ReactNode> = {
  "top-left": dot(true, "left"),
  "top-center": dot(true, "center"),
  "top-right": dot(true, "right"),
  "bottom-left": dot(false, "left"),
  "bottom-center": dot(false, "center"),
  "bottom-right": dot(false, "right"),
}

/** Calqué sur ThemeSegmented — même radiogroup, 6 options au lieu de 3. */
export function PositionSegmented({ value, onChange }: PositionSegmentedProps) {
  const t = useTranslation()
  return (
    <div className="segmented segmented-grid" role="radiogroup" aria-label={t("optionsPositionLabel")}>
      {OPTIONS.map(({ id, labelKey }) => (
        <label key={id}>
          <input type="radio" name="position" value={id} checked={value === id} onChange={() => onChange(id)} />
          <span className="seg">
            {ICONS[id]}
            <span>{t(labelKey)}</span>
          </span>
        </label>
      ))}
    </div>
  )
}
