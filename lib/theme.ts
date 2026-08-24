import type { ColorTheme } from "./ui-prefs.ts"

/**
 * Pose ou retire `data-orateur-theme` sur un élément — `<html>` par défaut
 * pour la page d'options, ou le host d'un shadow root pour la pastille et la
 * bulle de sélection (lib/charte.ts). "system" retire l'attribut : le CSS
 * retombe alors sur `prefers-color-scheme`, la même règle que main.tsx
 * applique avant le premier rendu.
 */
export function applyTheme(theme: ColorTheme, element: Element = document.documentElement) {
  if (theme === "system") element.removeAttribute("data-orateur-theme")
  else element.setAttribute("data-orateur-theme", theme)
}
