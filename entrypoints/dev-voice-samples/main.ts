/**
 * Page de développement, non liée depuis l'UI — jamais visitée en usage
 * normal. Synthétise les 10 échantillons Supertonic pour
 * public/voice-samples/ (aujourd'hui des .opus silencieux, voir leur
 * README) : le clip de chaque voix, en anglais, à vitesse neutre — le
 * ralenti/accéléré se fait côté lecteur via `audio.playbackRate`
 * (VoicePreviewButton.tsx), pas ici.
 *
 * Usage : `npm run dev`, ouvrir chrome-extension://<id>/dev-voice-samples.html
 * (l'id est visible sur chrome://extensions), cliquer Générer. Le premier
 * lancement télécharge les 398 Mo du modèle comme une lecture normale.
 * Chaque ligne produite s'écoute avant d'être téléchargée en .wav ; les
 * convertir ensuite en .opus (voir la commande affichée en bas de page) et
 * remplacer les fichiers dans public/voice-samples/.
 */
import { loadModelFiles } from "../../lib/supertonic/model-cache.ts"
import { loadTextToSpeechEngine, loadVoiceStyle, writeWavFile } from "../../lib/supertonic/engine.ts"
import { SUPERTONIC_VOICES } from "../../lib/supertonic/types.ts"

const SAMPLE_TEXT = "This is what this voice sounds like."
const SAMPLE_LANG = "en"

const root = document.getElementById("root")!
root.innerHTML = `
  <style>
    body { font: 14px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    button { font: inherit; padding: 0.5rem 1rem; cursor: pointer; }
    button:disabled { cursor: default; opacity: 0.6; }
    #log { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 0.8125rem; margin-top: 1rem; }
    .row { display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0; }
    .row strong { width: 2.5rem; }
    code { background: #eee; padding: 0.125rem 0.375rem; border-radius: 4px; }
  </style>
  <h1>Génération des échantillons de voix</h1>
  <p>Page de développement — voir le commentaire en tête de ce fichier.</p>
  <button id="run">Générer les 10 échantillons</button>
  <div id="rows"></div>
  <pre id="log"></pre>
`

const runButton = document.getElementById("run") as HTMLButtonElement
const rows = document.getElementById("rows")!
const log = document.getElementById("log")!

function print(line: string) {
  log.textContent += line + "\n"
}

function downloadName(voice: string) {
  return `${voice}.wav`
}

runButton.addEventListener("click", () => void run())

async function run() {
  runButton.disabled = true
  log.textContent = ""
  rows.innerHTML = ""

  print("Chargement du modèle…")
  const getFile = await loadModelFiles((p) => {
    if (p.phase === "downloading") {
      const pct = p.bytesTotal ? Math.round((p.bytesLoaded / p.bytesTotal) * 100) : 0
      print(`  ${p.fileName} — ${pct}%`)
    }
  })

  const tts = await loadTextToSpeechEngine(getFile, (p) => {
    print(`  moteur : ${p.name} (${p.index + 1}/${p.total})`)
  })
  print("Modèle chargé.\n")

  for (const voice of SUPERTONIC_VOICES) {
    print(`Synthèse ${voice}…`)
    const style = await loadVoiceStyle(voice)
    const wav = await tts.synthesize(SAMPLE_TEXT, SAMPLE_LANG, style)
    const buffer = writeWavFile(wav, tts.sampleRate)
    const blob = new Blob([buffer], { type: "audio/wav" })
    const url = URL.createObjectURL(blob)

    const row = document.createElement("div")
    row.className = "row"
    row.innerHTML = `
      <strong>${voice}</strong>
      <audio controls src="${url}"></audio>
      <a href="${url}" download="${downloadName(voice)}">Télécharger</a>
    `
    rows.append(row)
  }

  print("\nTerminé. Une fois les 10 .wav écoutés et téléchargés, convertir chacun :")
  print("  ffmpeg -i F1.wav -c:a libopus -b:a 24k public/voice-samples/F1.opus")
  print("(répéter pour M1..M5, F2..F5) puis remplacer les placeholders silencieux.")
  runButton.disabled = false
}
