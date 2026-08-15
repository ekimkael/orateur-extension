/**
 * SPIKE PHASE 3 — jetable.
 *
 * Le pipeline réel (pas les tenseurs bidons du spike de phase 0) : télécharge
 * les modèles fp32 dans l'OPFS, charge les 4 sessions, synthétise une phrase
 * codée en dur, la joue. Appelé deux fois de suite par l'appelant : le premier
 * appel donne les chiffres « à froid » (téléchargement compris), le second
 * les chiffres « à chaud » (modèles déjà en cache, nouvelles sessions) —
 * même méthodologie que le banc de la phase 0a dans le web app.
 *
 * Les résultats partent en HTTP vers `scratchpad/sink.mjs`, comme pour le
 * spike de phase 0 : ni un document offscreen ni une page de fond ne
 * s'inspectent depuis l'extérieur.
 */
import { loadModelFiles } from "./supertonic/model-cache.ts"
import { loadTextToSpeechEngine, loadVoiceStyle, writeWavFile } from "./supertonic/engine.ts"

const SINK = "http://localhost:9998"
const PHRASE =
  "Orateur transforme n'importe quel article en séance d'écoute, et reprend exactement là où vous vous étiez arrêté."

export async function runSpikePhrase(hote: string) {
  const report: Record<string, unknown> = { hote, quand: new Date().toISOString() }
  try {
    const t0 = performance.now()
    const getFile = await loadModelFiles((p) => {
      if (p.phase === "downloading" || p.phase === "cached") {
        console.log(
          `[spike3:${hote}] ${p.phase} ${p.fileIndex + 1}/${p.totalFiles} ${p.fileName} ` +
            `${Math.round(p.bytesLoaded / 1048576)}/${Math.round(p.bytesTotal / 1048576)} Mo`
        )
      }
    })
    report.downloadMs = Math.round(performance.now() - t0)

    const t1 = performance.now()
    const engine = await loadTextToSpeechEngine(getFile, (p) =>
      console.log(`[spike3:${hote}] session ${p.index + 1}/${p.total} ${p.name}`)
    )
    report.loadSessionsMs = Math.round(performance.now() - t1)

    const style = await loadVoiceStyle("F1")

    // Échauffement — la découverte de la phase 0a : le premier run() de
    // chaque session coûte des secondes, les suivants des millisecondes.
    const tWarm = performance.now()
    await engine.synthesize("Bonjour.", "fr", style, 8, 1.0)
    report.echauffementMs = Math.round(performance.now() - tWarm)

    const t2 = performance.now()
    const pcm = await engine.synthesize(PHRASE, "fr", style, 8, 1.0)
    report.syntheseMs = Math.round(performance.now() - t2)
    report.audioMs = Math.round((pcm.length / engine.sampleRate) * 1000)
    report.rtf = +((report.syntheseMs as number) / (report.audioMs as number)).toFixed(3)
    report.tempsJusquauPremierSonMs =
      (report.downloadMs as number) +
      (report.loadSessionsMs as number) +
      (report.echauffementMs as number) +
      (report.syntheseMs as number)

    const wav = writeWavFile(pcm, engine.sampleRate)
    const bytes = new Uint8Array(wav)

    // Preuve audible : lecture réelle, sans geste (mécanisme déjà vérifié en
    // phase 0). L'écoute elle-même reste un jugement humain — le WAV part
    // aussi vers le récepteur pour que l'utilisateur puisse l'ouvrir.
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })))
    await audio.play()
    report.aJoue = !audio.paused

    await fetch(`${SINK}/phase3-${hote}.wav`, { method: "POST", body: bytes })
    report.ok = true
  } catch (e) {
    report.ok = false
    report.erreur = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)
  }

  console.log(`[spike3:${hote}]`, JSON.stringify(report, null, 1))
  try {
    await fetch(`${SINK}/phase3-${hote}.json`, { method: "POST", body: JSON.stringify(report, null, 1) })
  } catch (e) {
    console.error(`[spike3:${hote}] récepteur injoignable`, e)
  }
}
