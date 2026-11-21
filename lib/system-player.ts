/**
 * The browser's own voices (`speechSynthesis`): no network, no model, and the
 * whole position — paragraph and word — kept here, next to the page.
 */

import { createSpeechPreparation } from "./prepare-speech.ts"
import type { Player, PlayerOptions } from "./player.ts"

/**
 * Reads with `speechSynthesis`, one utterance per paragraph.
 *
 * @param options.lang The page's declared language; the text may override it.
 */
export function createSystemPlayer(options: PlayerOptions & { lang?: string }): Player {
  const { startBlock, source, prefs, emit } = options
  const speech = createSpeechPreparation(options, options.lang)
  const blocks = speech.paragraphs

  /** Position de lecture : le bloc en cours, et où la voix en est dedans. */
  let blockIndex = startBlock
  let charIndex = 0
  // Notre propre drapeau, jamais `speechSynthesis.paused` : Chrome ne met
  // le sien à jour qu'après coup, on relirait l'état d'avant le clic.
  let paused = false
  /** Un réglage a changé pendant la pause : à appliquer à la reprise. */
  let stale = false
  /**
   * Numéro de la file en cours.
   *
   * Relancer la lecture passe par `cancel()`, qui fait remonter un `end` sur
   * l'utterance coupée — indistinguable d'une fin naturelle. Chaque file
   * garde le numéro qu'elle avait à sa création : celle qui n'est plus la
   * courante sait que son `end` est un contrecoup. `dispose()` en change
   * aussi, ce qui écarte tout ce qui est encore en vol.
   */
  let generation = 0

  /**
   * Relance la lecture à partir de `blockIndex`/`charIndex`, aux réglages
   * du moment. Appelée au démarrage comme à chaque changement de vitesse
   * ou de voix : dans les deux cas on repart du mot où la voix en était.
   *
   * Un seul énoncé en vol à la fois (`play`), jamais toute la file
   * poussée d'un coup dans `speechSynthesis.speak()` : sur Chrome/Windows,
   * plusieurs énoncés mis en file en même temps se chevauchent ou
   * s'interrompent au hasard — bug connu de la file native. Enchaîner au
   * `end` du précédent est le contournement standard, et il gagne au
   * passage la robustesse qui manquait avant : `error` avance aussi à la
   * suite plutôt que de laisser la pastille dépliée sans plus jamais rien
   * dire.
   */
  function speak() {
    generation++
    cancelSpeech()
    void play(blockIndex, charIndex)
  }

  async function play(block: number, from: number) {
    const mine = generation
    let prepared = blocks[block]
    while (prepared) {
      if (source) {
        blockIndex = block
        charIndex = from
        try {
          const current = await source.prepare(block, prefs().follow)
          if (mine !== generation) return
          if (paused) {
            stale = true
            return
          }
          const refreshed = speech.refresh(block, current)
          if (refreshed.text !== prepared.text || refreshed.lang !== prepared.lang) from = 0
          prepared = blocks[block] = refreshed
        } catch {
          if (mine !== generation) return
          emit({ phase: "error", reason: "preparation" })
          return
        }
      }
      if (prepared.text) break
      prepared = blocks[++block]
      from = 0
    }
    if (!prepared) return emit({ phase: "ended" })

    // Résolue à chaque énoncé : `getVoices()` reconstruit sa liste à
    // chaque appel. Introuvable (voix désinstallée, autre machine) vaut
    // défaut.
    const { voiceURI, speed } = prefs()
    const voice = voiceURI
      ? speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)
      : undefined
    const utterance = new SpeechSynthesisUtterance(prepared.text.slice(from))
    if (prepared.lang !== "na") utterance.lang = prepared.lang
    utterance.rate = speed
    // A saved voice overrides `lang`, including on a translated page.
    // Let the browser choose when that voice speaks another language.
    if (voice && (!utterance.lang || voice.lang.toLowerCase().split(/[-_]/)[0] === utterance.lang.toLowerCase().split(/[-_]/)[0])) {
      utterance.voice = voice
    }

    utterance.addEventListener("start", () => {
      if (mine !== generation) return
      blockIndex = block
      charIndex = from
      // A start racing a pause must not show the pill as playing again.
      if (!paused) emit({ phase: "playing", block, total: blocks.length })
      if (source && block + 1 < blocks.length) {
        void source.prepare(block + 1, prefs().follow, true, "nearest").catch(() => {})
      }
    })
    // `charIndex` est compté depuis le début de l'énoncé, donc depuis le
    // reste du bloc : le rebaser sur le bloc entier, sinon une deuxième
    // reprise repartirait trop tôt.
    //
    // ponytail: les voix distantes n'émettent pas toujours `boundary`. Sans
    // lui la position reste au dernier départ, et changer la vitesse fait
    // reprendre le bloc courant depuis là — jamais plus loin que ça.
    utterance.addEventListener("boundary", (event) => {
      if (mine !== generation) return
      charIndex = from + event.charIndex
    })
    utterance.addEventListener("end", () => {
      if (mine !== generation) return
      void play(block + 1, 0)
    })
    // Un énoncé qui échoue à se synthétiser ne doit pas taire tout le
    // reste de l'article : avancer quand même, comme une fin naturelle.
    utterance.addEventListener("error", () => {
      if (mine !== generation) return
      emit({ phase: "error", reason: "synthesis", recoverable: true })
      void play(block + 1, 0)
    })
    speechSynthesis.speak(utterance)
  }

  function dispose() {
    generation++
  }

  return {
    engine: "system",
    hasSpeech: speech.hasSpeech,
    start: speak,
    pause() {
      paused = true
      speechSynthesis.pause()
    },
    resume() {
      paused = false
      // La file en attente porte encore l'ancienne vitesse : la refaire plutôt
      // que la reprendre, sinon le réglage change au bloc suivant seulement.
      if (stale) {
        stale = false
        speak()
      } else speechSynthesis.resume()
    },
    seek(block) {
      blockIndex = block
      charIndex = 0
      if (paused) {
        generation++
        cancelSpeech()
        stale = true
      } else speak()
    },
    update(previous) {
      const next = prefs()
      if (next.speed === previous.speed && next.voiceURI === previous.voiceURI) return
      // La synthèse ne réaccorde pas un utterance déjà lancé : le seul moyen
      // d'entendre la nouvelle vitesse est de refaire la file à partir du mot
      // en cours. En pause, on attend la reprise plutôt que de repartir tout
      // seul — `cancel()` déferait la pause.
      if (paused) stale = true
      else speak()
    },
    stop() {
      dispose()
      cancelSpeech()
    },
    dispose,
  }
}

/**
 * Annule la synthèse en cours.
 *
 * Chrome garde sa file quand on annule une lecture en pause : elle repart au
 * `speak()` suivant. Reprendre avant d'annuler la vide pour de bon.
 */
export function cancelSpeech() {
  speechSynthesis.resume()
  speechSynthesis.cancel()
}
