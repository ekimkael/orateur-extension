import "./style.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { loadUiPrefs } from "../../lib/ui-prefs"
import { applyTheme } from "../../lib/theme"

/**
 * Pose data-orateur-theme avant le premier rendu React : l'appliquer depuis
 * un useEffect ferait flasher la page dans le thème du système avant de
 * basculer sur le choix explicite de l'utilisateur (App.tsx garde ensuite
 * l'attribut synchronisé sur les changements ultérieurs).
 */
void loadUiPrefs().then((prefs) => {
  applyTheme(prefs.theme)
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
