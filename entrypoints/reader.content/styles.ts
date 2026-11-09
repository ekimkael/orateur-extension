import { charteTokens } from "../../lib/charte.ts"

/**
 * The pill's stylesheet, adopted by its closed shadow root. `scripts/reader-model.mjs`
 * reads the button icons from this file's source.
 */
export const PILL_CSS = charteTokens(".pill-row") + `
* { box-sizing: border-box }
[hidden] { display: none !important }
.pill-row {
  accent-color: var(--primary);
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 48px);
  padding: 6px;
  border-radius: 999px;
  font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  color: var(--foreground);
  border: 1px solid transparent;
  position: relative;
  isolation: isolate;
}
.pill-surface {
  position: absolute;
  left: -1px;
  top: -1px;
  width: calc(100% + 2px);
  height: calc(100% + 2px);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  box-shadow: var(--shadow);
  transform-origin: top left;
  pointer-events: none;
  z-index: -1;
}
.pill-surface-card { border-radius: 20px; opacity: 0 }
:host([data-expanded]) .pill-surface-card { opacity: 1 }
:host([data-expanded]) .pill-surface-compact { opacity: 0 }
.pill-content-copy {
  position: absolute;
  padding: 2px 4px 12px;
  pointer-events: none;
}
.pill-row[data-active] { width: min(336px, calc(100vw - 48px)) }
:host([data-expanded]) .pill-row {
  padding: 12px;
  border-radius: 20px;
}
.pill-content { padding: 2px 4px 12px; min-width: 0 }
.pill-row[data-settings-open]:not([data-loading]) .pill-content {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
}
.pill-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.pill-status-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 4px }
.pill-status { flex: 1; min-width: 0; color: var(--muted-foreground); overflow-wrap: anywhere }
.pill-percent { font-variant-numeric: tabular-nums; color: var(--muted-foreground) }
.pill-controls { display: flex; align-items: center; gap: 4px }
/* Hide toast: one short line and its Undo, in the pill's own surface. */
.pill-toast { display: flex; align-items: center; gap: 8px; padding-left: 10px }
.pill-toast-text { min-width: 0; overflow-wrap: anywhere }
/* Foreground, not --primary: #f54e00 on the light theme's white card is 3.5:1. */
.pill-toast-undo {
  width: auto;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.pill-transport { display: flex; align-items: center; gap: 4px }
.pill-meta { flex: 1; text-align: center; font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums }
.pill-spacer { flex: 1 }
.pill-row[data-loading] {
  flex-direction: row;
  align-items: center;
  gap: 4px;
}
.pill-row[data-loading] .pill-controls { display: contents }
.pill-row[data-loading] .pill-transport { order: 1 }
.pill-row[data-loading] .pill-content {
  order: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  padding: 0 4px;
}
.pill-row[data-loading] .pill-settings { order: 3 }
.pill-row[data-loading] .pill-secondary { order: 4 }
.pill-row[data-loading] .pill-status-row { flex: 1; min-width: 0; margin: 0 }
.pill-row[data-loading] .pill-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pill-row[data-loading] .pill-primary:disabled { opacity: 1; cursor: wait }
.pill-row[data-loading] .pill-progress { flex: 1; height: 6px; margin: 0 }
.pill-row[data-downloading] .pill-status-row {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}
button:hover:not(:disabled), .pill-settings[aria-expanded="true"] { background: color-mix(in srgb, var(--foreground) 8%, transparent) }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
button:disabled { opacity: 0.55; cursor: default }
@media (prefers-reduced-motion: no-preference) {
  button { transition: transform 160ms var(--ease-out) }
  button:active:not(:disabled):not(:focus-visible) { transform: scale(0.97); transition-duration: 100ms }
}
/*
 * Bouton principal (▶/⏸) : seul rempli de la pastille, à la couleur de marque
 * — c'est lui qui lance ou suspend la lecture, les deux autres ne font
 * qu'accompagner ou interrompre.
 */
.pill-primary { width: 40px; height: 40px; background: var(--primary); color: var(--primary-foreground) }
.pill-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 88%, black) }
.pill-primary:focus-visible { outline-color: var(--foreground) }
/*
 * Icône en masque plutôt qu'en emoji : le rendu diffère en couleur et en
 * chasse selon l'OS. Le masque suit currentColor, donc l'état désactivé et le
 * focus restent cohérents avec les autres boutons, et rien n'entre dans le
 * DOM — pas de SVG à injecter sur une page en Trusted Types.
 */
button[data-icon]::before {
  content: "";
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}
button[data-icon="settings"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E");
}
button[data-icon="cloud-download"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 13v8l-4-4m4 4 4-4M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284'/%3E%3C/svg%3E");
}
button[data-icon="play"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'/%3E%3C/svg%3E");
}
button[data-icon="pause"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='14' y='3' width='5' height='18' rx='1'/%3E%3Crect x='5' y='3' width='5' height='18' rx='1'/%3E%3C/svg%3E");
}
button[data-icon="square"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3C/svg%3E");
}
button[data-icon="x"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 6 6 18'/%3E%3Cpath d='m6 6 12 12'/%3E%3C/svg%3E");
}
button[data-icon="previous"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
}
button[data-icon="next"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
}
/* Rotate the loading icon only; the button itself remains stationary. */
button[data-icon="loader-circle"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12a9 9 0 1 1-6.219-8.56'/%3E%3C/svg%3E");
}
@media (prefers-reduced-motion: no-preference) {
  button[data-icon="loader-circle"]::before { animation: loading-spin 700ms linear infinite }
}
.settings-popover {
  position: absolute;
  bottom: 100%;
  right: -1px;
  /* Même fond que la pastille : le popover en est le prolongement, pas une
     surface étrangère posée dessus. Le liseré fait l'arête. */
  background: var(--card);
  border-radius: 16px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: 16px;
  width: min(336px, calc(100vw - 48px));
  max-height: calc(100dvh - 200px);
  overflow-y: auto;
  overscroll-behavior: contain;
  color: var(--foreground);
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  z-index: 10000;
  margin-bottom: 8px;
}
@media (prefers-reduced-motion: reduce) {
  button:active:not(:disabled) { transform: none }
}
.settings-popover[data-open] {
  opacity: 1;
  pointer-events: auto;
}
/* Keep settings inside the viewport at all six dock positions. */
:host([data-orateur-position$="left"]) .settings-popover { right: auto; left: -1px }
:host([data-orateur-position^="top"]) .settings-popover {
  bottom: auto;
  top: 100%;
  margin-bottom: 0;
  margin-top: 8px;
}
:host([data-orateur-position$="center"]) .settings-popover {
  right: auto;
  left: 50%;
  translate: -50% 0;
}
@media (prefers-reduced-motion: no-preference) {
  .pill-progress-fill { transition: transform 150ms linear }
}
@keyframes loading-spin { to { transform: rotate(360deg) } }
.pill-progress {
  height: 3px;
  margin-top: 10px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}
.pill-progress-fill {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: left;
  background: var(--primary);
}
/*
 * Une case à cocher se lit en ligne, intitulé à droite — pas dans la colonne
 * de .settings-row, où le contrôle prend toute la largeur.
 */
.settings-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  cursor: pointer;
}
.settings-toggle input { flex: none; margin: 0; cursor: pointer }
.settings-toggle input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
.settings-row { display: flex; flex-direction: column; gap: 6px }
.settings-row + .settings-row { margin-top: 12px }
.settings-note + .settings-row { margin-top: 12px }
.settings-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
  font-weight: 600;
  cursor: pointer;
}
/* La valeur vit dans l'intitulé, à droite : elle appartient au réglage, pas à
   une ligne de plus. Chasse fixe pour que 1,0× et 1,2× ne la fassent pas
   sauter d'un pixel à chaque cran. */
.settings-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.settings-control {
  width: 100%;
  font: inherit;
  font-size: 13px;
  min-height: 36px;
  color: var(--foreground);
  cursor: pointer;
}
select.settings-control {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--background);
  /* Un select natif tronque tout seul ; sans ça un nom de voix à rallonge
     élargit le popover jusqu'à le sortir de l'écran. */
  max-width: 100%;
}
select.settings-control:hover { background: color-mix(in srgb, var(--foreground) 6%, var(--background)) }
input.settings-control { margin: 2px 0 }
.settings-control:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
/* Le coût du premier ▶ Supertonic, collé à la ligne Moteur — c'est ce qui le
   rend acceptable plutôt que subi. Masqué par défaut : afficher un [hidden]
   coûte moins qu'un état de plus dans syncControls(). */
.settings-note {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted-foreground);
}
.settings-note strong { color: var(--foreground); font-weight: 600 }
.settings-download {
  width: 100%;
  height: auto;
  min-height: 36px;
  margin-top: 8px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--primary-foreground);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
}
.settings-download:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 88%, black) }
.settings-download:focus-visible { outline-color: var(--foreground) }
`
