import type { ColorTheme } from "./ui-prefs.ts"

/**
 * Pose ou retire `data-orateur-theme` sur `<html>`. "system" retire
 * l'attribut : `entrypoints/options/style.css` retombe alors sur
 * `prefers-color-scheme`, la même règle que main.tsx applique avant le
 * premier rendu.
 */
export function applyTheme(theme: ColorTheme) {
  if (theme === "system") document.documentElement.removeAttribute("data-orateur-theme")
  else document.documentElement.setAttribute("data-orateur-theme", theme)
}
