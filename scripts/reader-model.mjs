import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as k from "./anatomy/kit/iso-kit.mjs"
import { buildReaderGeometry } from "./reader-geometry.mjs"

const license = `<!-- Anatomy kit attribution\n${readFileSync(new URL("./anatomy/kit/LICENSE", import.meta.url), "utf8")}-->\n`
const root = new URL("../", import.meta.url)
const source = readFileSync(new URL("entrypoints/reader.content.ts", root), "utf8")
const messages = JSON.parse(readFileSync(new URL("public/_locales/fr/messages.json", root), "utf8"))
const theme = process.argv.includes("--light") ? "light" : "dark"
const icons = Object.fromEntries([...source.matchAll(/button\[data-icon="([^"]+)"\] \{\s*--icon: url\("data:image\/svg\+xml,([^"\n]+)"\)/g)]
  .map(([, name, encoded]) => [name, decodeURIComponent(encoded).replace(/stroke='#000'/, 'stroke="currentColor"')]))
for (const name of ["previous", "next", "pause", "play", "settings", "square"]) {
  if (!icons[name]) throw new Error(`Missing original reader icon: ${name}`)
}
const msg = (name) => messages[name].message
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")
const art = buildReaderGeometry({ audit: process.argv.includes("--audit") })
const { P, faceZ, facePlan, buttonZ } = art
const face = k.topMatrix([facePlan.x, facePlan.y], faceZ + 0.04, P)
const buttonFace = k.topMatrix([facePlan.x, facePlan.y], buttonZ + 0.04, P)
const vector = k.axisVector(P, art.travel)

/**
 * Literal facade measured from the native 336 px reader: preserve title/status
 * baselines, 40/36 px controls, 16 px source masks and metadata placement.
 * Icons and hit targets sit on the raised caps' top plane, above the glass.
 * Depth and hidden internals illustrate a physical object, not real hardware.
 */
function button(name, x, label, primary = false) {
  const glyph = icons[primary ? "pause" : name].replace("<svg", '<svg width="16" height="16"')
  return `<g class="drawn-button${primary ? " primary" : ""}" data-action="${primary ? "primary" : name}" tabindex="0" role="button" aria-label="${escape(label)}">
    <circle class="button-hit" cx="${x}" cy="88.78125" r="${primary ? 20 : 18}"/>
    <g data-icon="" transform="translate(${x - 8} 80.78125)">${glyph}</g>
  </g>`
}
const interfaceSvg = `<g data-motion="exploded" data-move="${vector.join(" ")}"><g class="reader-face" transform="${face}">
<defs><clipPath id="reader-screen"><rect width="336" height="121.78125" rx="20"/></clipPath></defs><g clip-path="url(#reader-screen)">
<text class="reader-title" x="17" y="29.2">Retrouver le plaisir de lire</text>
<text class="reader-status" x="17" y="52.2">${escape(msg("readerPlaying"))}</text>
<text class="reader-meta" x="190" y="92.6" text-anchor="middle">3 / 12 · 1,0×</text>
</g></g><g class="reader-face" transform="${buttonFace}">
${button("previous", 31, msg("ariaPreviousParagraph"))}${button("pause", 73, msg("ariaPause"), true)}${button("next", 115, msg("ariaNextParagraph"))}
${button("settings", 265, msg("ariaReadingSettings"))}${button("square", 305, msg("ariaStopReading"))}
</g></g>`
const halo = `<path class="iso-halo" d="${k.haloOf(facePlan, -5, 1, P)}"/>`
const svg = k.figureSvg({ width: art.width, height: art.height,
  label: "Le lecteur actuel de l’extension Orateur dessiné comme un objet en relief : même façade, mêmes commandes, bouton orange, boîtier chanfreiné et vue décomposée.",
  body: [halo, art.svg, interfaceSvg],
}).replace('role="img"', 'role="group"')
const plate = k.plateHtml({ fig: "Fig 01", title: "Le lecteur de l’extension", hint: "Essayez les commandes dessinées", readout: "Lecture en cours · 3 / 12",
  keys: [{ mark: "raised", label: "Façade du lecteur actuel" }, { mark: "lit", label: "Commande de lecture" }],
  caption: "Le lecteur actuel, dessiné dans le style Anatomy. Forme, textes, couleurs et disposition d’origine ; épaisseur et pièces du boîtier interprétées en objet physique.",
  body: `<div class="iso-stage">${svg}</div>`,
})
const css = `
html{color-scheme:${theme}}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.iso-page{width:min(1060px,100% - 40px);margin:44px auto 60px}
.page-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.eyebrow{font:11px/1.4 var(--anatomy-mono);letter-spacing:.13em;color:var(--anatomy-muted)}h1{font-size:30px;line-height:1.2;letter-spacing:-.7px;font-weight:550;color:var(--anatomy-strong);margin:12px 0 10px}.intro{font-size:14px;max-width:600px;margin:0;color:var(--anatomy-text)}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:24px}.tools button,.theme-button{border:1px solid var(--anatomy-faint);border-radius:6px;color:var(--anatomy-strong);background:var(--anatomy-card);font:12px/1.4 system-ui;min-height:36px;padding:8px 12px;cursor:pointer}.tools button:hover,.theme-button:hover{border-color:var(--anatomy-mid)}button:focus-visible,input:focus-visible{outline:2px solid #f54e00;outline-offset:3px}.tools [aria-pressed=true]{border-color:var(--anatomy-mid)}.tools span{color:var(--anatomy-muted);font:11px var(--anatomy-mono);margin-left:auto}
.iso-figure{margin:18px 0}.iso-plate{padding:34px 18px 45px;overflow:hidden;border-radius:8px;box-shadow:0 0 0 1px var(--anatomy-faint)}.iso-stage{touch-action:pan-y}.iso-svg{overflow:visible}.iso-plate-corner{font-size:10px}.iso-key:last-child .iso-swatch path{stroke:#f54e00!important}
.reader-glass>.iso-top{fill:#161616}.reader-face{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;--reader-text:#e8e8e8;--reader-muted:#838383}.reader-title{font-weight:600;font-size:14px;fill:var(--reader-text)}.reader-status{font-size:13px;fill:var(--reader-muted)}.reader-meta{font-size:12px;fill:var(--reader-muted);font-variant-numeric:tabular-nums}.drawn-button{color:var(--reader-text);cursor:pointer;outline:none}.drawn-button svg *{vector-effect:none}.button-hit{fill:transparent;stroke:transparent;stroke-width:1}.primary .button-hit{fill:#f54e00;stroke:#f54e00}.primary{color:#fff}.drawn-button:hover:not(.primary) .button-hit{fill:#ffffff10}.drawn-button:focus-visible .button-hit{stroke:#f54e00;stroke-width:2}.primary:focus-visible .button-hit{stroke:var(--reader-text)}
.iso[data-theme=light] .reader-glass>.iso-top{fill:#fff}.iso[data-theme=light] .reader-face{--reader-text:#1a1a1a;--reader-muted:#6b6b6b}.iso[data-theme=light] .drawn-button:hover:not(.primary) .button-hit{fill:#00000009}
.reader-button-cap>.iso-top{fill:#242424}.iso[data-theme=light] .reader-button-cap>.iso-top{fill:#fff}.reader-primary-cap>.iso-top,.iso[data-theme=light] .reader-primary-cap>.iso-top{fill:#f54e00}.reader-primary-cap>.iso-shade[data-shade="0"]{fill:#8e2b00}.reader-primary-cap>.iso-shade[data-shade="1"]{fill:#aa3400}.reader-primary-cap>.iso-shade[data-shade="2"]{fill:#c83d00}.reader-primary-cap>.iso-shade[data-shade="3"]{fill:#e34700}.reader-primary-cap>.iso-edge{stroke:#c83d00}.primary .button-hit{fill:transparent;stroke:transparent}
.footnote{font-size:12px;color:var(--anatomy-muted);margin:20px 0 0}.demo-settings{display:none;border:1px solid var(--anatomy-faint);padding:16px;border-radius:8px;background:var(--anatomy-card);margin-top:16px}.demo-settings[data-open]{display:block}.demo-settings label{display:flex;align-items:center;gap:12px;font-size:12px}.demo-settings input{accent-color:#f54e00}.demo-settings output{font-variant-numeric:tabular-nums}
@media(max-width:560px){.iso-page{width:calc(100% - 24px);margin:24px auto}.page-header{gap:10px}h1{font-size:24px}.intro{font-size:13px}.theme-button{white-space:nowrap}.tools span{width:100%;margin:4px 0 0}.iso-plate{padding:48px 0 72px}.iso-plate-corner{font-size:8.5px}.iso-plate-corners{inset:16px 12px}.iso-legend{font-size:12px}}
`
const script = `
const motion=[...document.querySelectorAll('[data-motion]')].map(el=>({el,by:el.dataset.move.split(' ').map(Number)}));
const stage=document.querySelector('.iso-stage'),still=matchMedia('(prefers-reduced-motion: reduce)');
const status=document.querySelector('.reader-status'),meta=document.querySelector('.reader-meta'),readout=document.querySelector('[data-readout]');
const primary=document.querySelector('[data-action=primary]'),icon=primary.querySelector('[data-icon]');
const icons=${JSON.stringify({play:icons.play,pause:icons.pause})};
let playing=true,block=2,speed=1,apart=0,target=0,visible=false,frame=0,last=0,tour=true,clock=0,hover=false,focused=false;
const write=(el,text)=>{if(el.textContent!==text)el.textContent=text;};
function update(){const label=playing?'Lecture en cours':'En pause';write(status,label);write(meta,(block+1)+' / 12 · '+speed.toLocaleString('fr',{minimumFractionDigits:1,maximumFractionDigits:1})+'×');write(readout,apart>.001?(target?'Vue décomposée':'Assemblage')+' · ${art.parts} pièces':label+' · '+(block+1)+' / 12');primary.setAttribute('aria-label',playing?'Mettre en pause':'Reprendre');stage.dataset.block=String(block);}
function setGlyph(){icon.innerHTML=icons[playing?'pause':'play'].replace('<svg','<svg width="16" height="16"');}
function draw(){motion.forEach(({el,by})=>el.setAttribute('transform','translate('+by[0]*apart+' '+by[1]*apart+')'));stage.dataset.apart=String(apart);update();}
function loop(now){frame=0;const dt=last?Math.min((now-last)/1000,1/30):1/60;last=now;if(tour&&!still.matches&&!hover&&!focused&&playing&&!target){clock+=dt*speed;if(clock>=3){clock=0;block=(block+1)%12;}}apart=still.matches?target:apart+(target-apart)*(1-Math.exp(-dt/.24));if(Math.abs(apart-target)<.0001)apart=target;draw();if(visible&&!document.hidden&&(apart!==target||(tour&&!still.matches&&!hover&&!focused&&playing&&!target)))frame=requestAnimationFrame(loop);}
function run(){if(!frame&&visible&&!document.hidden){last=0;frame=requestAnimationFrame(loop);}}
function act(action){tour=false;if(action==='primary')playing=!playing;if(action==='previous')block=Math.max(0,block-1);if(action==='next')block=Math.min(11,block+1);if(action==='square'){playing=false;block=0;}if(action==='settings'){const panel=document.querySelector('.demo-settings');panel.toggleAttribute('data-open');document.querySelector('[data-action=settings]').setAttribute('aria-expanded',String(panel.hasAttribute('data-open')));}clock=0;setGlyph();update();run();}
document.querySelectorAll('[data-action]').forEach(el=>{el.addEventListener('click',()=>act(el.dataset.action));el.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();act(el.dataset.action);}});});
document.querySelector('#apart').addEventListener('click',e=>{tour=false;target=1-target;e.currentTarget.setAttribute('aria-pressed',String(!!target));e.currentTarget.textContent=target?'Assembler':'Décomposer';run();});
document.querySelector('#tour').addEventListener('click',()=>{tour=true;playing=true;block=2;clock=0;target=0;document.querySelector('#apart').setAttribute('aria-pressed','false');document.querySelector('#apart').textContent='Décomposer';setGlyph();update();run();});
document.querySelector('#theme').addEventListener('click',e=>{const light=document.body.dataset.theme!=='light';document.body.dataset.theme=light?'light':'dark';document.documentElement.style.colorScheme=light?'light':'dark';e.currentTarget.textContent=light?'Thème sombre':'Thème clair';});
document.querySelector('#speed').addEventListener('input',e=>{speed=e.target.valueAsNumber;document.querySelector('output').textContent=speed.toLocaleString('fr',{minimumFractionDigits:1,maximumFractionDigits:1})+'×';update();});
stage.addEventListener('pointerenter',()=>{hover=true;});stage.addEventListener('pointerleave',()=>{hover=false;run();});stage.addEventListener('focusin',()=>{focused=true;});stage.addEventListener('focusout',e=>{if(!stage.contains(e.relatedTarget)){focused=false;run();}});
new IntersectionObserver(entries=>{visible=entries[entries.length-1].isIntersecting;if(visible)run();else{cancelAnimationFrame(frame);frame=0;}},{threshold:.05}).observe(stage);
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else run();});still.addEventListener('change',()=>{if(still.matches){apart=target;draw();}run();});update();
`
const body = `<style>${css}</style><header class="page-header"><div><div class="eyebrow">ORATEUR / ANATOMY · 01</div><h1>Le lecteur, dessiné.</h1><p class="intro">Le design actuel de l’extension, transformé en objet isométrique.</p></div><button id="theme" class="theme-button">${theme === "dark" ? "Thème clair" : "Thème sombre"}</button></header><div class="tools"><button id="apart" aria-pressed="false">Décomposer</button><button id="tour">Rejouer la démonstration</button><span>${art.parts} pièces · SVG vectoriel</span></div>${plate}<section class="demo-settings" aria-label="Réglages de la démonstration"><label>Vitesse <input id="speed" type="range" min="0.8" max="1.5" step="0.1" value="1"><output>1,0×</output></label></section><p class="footnote">Illustration interactive · Lecture simulée, sans audio.</p>`
const page = k.pageHtml({title:"Orateur · Le lecteur dessiné",theme,body,script,width:1060}).replace('<html lang="en">','<html lang="fr">')
const out = new URL(`docs/reader-model${theme === "light" ? "-light" : ""}.html`, root)
writeFileSync(out,license + page)
const vectorOut = new URL(`docs/reader-model${theme === "light" ? "-light" : ""}.svg`, root)
const exported = k.figureSvg({ width:art.width, height:art.height, label:"Le lecteur Orateur dessiné en isométrie", body:[`<style>${css}</style>`,halo,art.svg,interfaceSvg], standalone:theme })
writeFileSync(vectorOut,license + exported)
console.log(`Reader drawing: ${fileURLToPath(out)} · ${art.parts} parts`)
