// lib/charte.ts
//
// Tokens de la charte, recopiés de entrypoints/options/style.css — qui les
// tient lui-même de web/app/app.css. C'est la charte, pas un nouveau système :
// aucune valeur ne doit être inventée ici.
//
// Les deux surfaces flottantes (pastille, bulle de sélection) vivent chacune
// dans un shadow root fermé, donc aucune ne peut lire le `:root` de la page.
// Elles se partagent cette fonction plutôt que deux copies du même bloc :
// c'est exactement la dérive qu'on est en train de corriger.

import type { ColorTheme } from "./ui-prefs.ts"

/** Valeurs indépendantes du thème : rayons et courbe d'accélération. */
const SHAPE = `
  --radius: 0.375rem;
  --radius-2xl: calc(var(--radius) * 1.8);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);`

const LIGHT = `
  color-scheme: light;
  --background: #f5f5f5;
  --foreground: #1a1a1a;
  --card: #ffffff;
  --muted-foreground: #6b6b6b;
  --border: #e0e0e0;
  --primary: #f54e00;
  --primary-foreground: #ffffff;
  --shadow: 0 4px 24px rgb(0 0 0 / 0.08);`

const DARK = `
  color-scheme: dark;
  --background: #0d0d0d;
  --foreground: #e8e8e8;
  --card: #161616;
  --muted-foreground: #7a7a7a;
  --border: #2a2a2a;
  --shadow: 0 4px 24px rgb(0 0 0 / 0.32);`

/**
 * Les trois blocs de la charte, posés sur `selector`.
 *
 * Même structure que entrypoints/options/style.css : clair par défaut, sombre
 * sous `prefers-color-scheme` sauf si le thème clair est forcé, sombre forcé
 * en dernier. Le bloc sombre est écrit deux fois, comme là-bas — un sélecteur
 * de plus coûterait moins de lignes mais rendrait la comparaison avec la page
 * d'options moins évidente.
 *
 * L'attribut est porté par le host du shadow root (voir `applyTheme`), et
 * jamais les tokens eux-mêmes : le style inline de l'hôte porte un
 * `all:initial!important` qui les écraserait.
 */
export function charteTokens(selector: string) {
  return `
${selector} {${SHAPE}${LIGHT}
}
@media (prefers-color-scheme: dark) {
  :host(:not([data-orateur-theme="light"])) ${selector} {${DARK}
  }
}
:host([data-orateur-theme="dark"]) ${selector} {${DARK}
}`
}

export type { ColorTheme }
