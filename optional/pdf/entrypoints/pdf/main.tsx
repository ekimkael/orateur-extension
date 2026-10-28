import "../../../../entrypoints/options/style.css"
import "./style.css"
import { createRoot } from "react-dom/client"
import { loadPrefs } from "../../../../lib/reader-prefs"
import { loadUiPrefs } from "../../../../lib/ui-prefs"
import { loadCatalog, resolveLocale, translate } from "../../../../lib/i18n"
import { applyTheme } from "../../../../lib/theme"
import { App } from "./App"

void Promise.all([loadPrefs(), loadUiPrefs()]).then(async ([prefs, ui]) => {
  applyTheme(ui.theme)
  const locale = resolveLocale(ui.language)
  const catalog = await loadCatalog(locale)
  document.documentElement.lang = locale
  createRoot(document.getElementById("root")!).render(
    <App initialPrefs={prefs} locale={locale} t={(key, subs) => translate(catalog, key, subs)} />,
  )
})
