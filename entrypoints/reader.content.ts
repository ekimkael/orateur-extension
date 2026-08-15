/**
 * Lecture de l'article directement sur la page, via la synthèse vocale native
 * du navigateur (`speechSynthesis`) — pas d'appel réseau, pas de dépendance.
 *
 * La pastille est posée sur toutes les pages, repliée sur un bouton ▶ tant
 * qu'aucune lecture n'est en cours : c'est ce qui permet de lancer la lecture
 * sans passer par le menu contextuel. Elle se déplie en barre pause/stop
 * pendant la lecture.
 */

import {
  loadPrefs,
  savePrefs,
  onPrefsChanged,
  SPEED,
  type ReaderEngine,
  type ReaderPreferences,
} from "../lib/reader-prefs"
import { expandText } from "../lib/pronunciation/index.ts"
import { buildReadingIntro } from "../lib/reading-intro"
import { toSupertonicLang, type SupportedLang } from "../lib/supertonic-lang.ts"
import {
  TTS_CONTROL,
  TTS_EVENT,
  TTS_SET_SPEED,
  TTS_SPEAK,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsSetSpeedMessage,
  type TtsSpeakMessage,
} from "../lib/tts-messages"
// Type uniquement — importer la valeur (la liste des 10 voix, ses libellés)
// depuis lib/supertonic/* ferait entrer le moteur dans ce bundle. La petite
// liste ci-dessous, plus bas dans ce fichier, est donc dupliquée à dessein.
import type { SupertonicVoice } from "../lib/supertonic/types.ts"

export interface ReadPagePayload {
  text: string
  title?: string
  lang?: string
}

export interface StartReadingMessage extends ReadPagePayload {
  type: typeof START_READING
}

export const START_READING = "orateur:start-reading"

/**
 * Demande d'extraction, envoyée au background au clic sur ▶.
 *
 * L'extraction reste là-bas : Readability ne doit pas entrer dans le bundle
 * d'un script chargé sur toutes les pages.
 */
export const READ_PAGE = "orateur:read-page"

/**
 * Signale un incident au background, seul contexte à pouvoir toucher le
 * badge de l'icône (`browser.action` n'existe pas dans un content script).
 */
export const NOTIFY = "orateur:notify"

export interface NotifyMessage {
  type: typeof NOTIFY
  message: string
}

/**
 * Clé de storage portant le jeton de l'onglet qui lit.
 *
 * `speechSynthesis` est partagé par tout le navigateur alors qu'il y a une
 * pastille par onglet : démarrer une lecture coupe celle d'à côté, dont la
 * pastille resterait dépliée sur une lecture morte. Chaque pastille inscrit
 * son jeton en prenant la parole, les autres le voient passer et se replient.
 *
 * Storage plutôt qu'un aiguillage par le background : rien à garder en mémoire
 * dans un service worker MV3 qui s'endort, et aucun onglet à recenser.
 *
 * Exportée : l'hôte Supertonic s'y abonne aussi, pour la même raison — sans
 * ça, un autre onglet qui prend la parole avec le moteur système laisserait
 * l'audio Supertonic tourner, sans plus aucune pastille pour l'arrêter.
 */
export const READER_TOKEN = "orateur:reading-tab"

type PillState = "idle" | "loading" | "playing" | "paused"

export default defineContentScript({
  // Déclaré dans le manifest, contrairement à l'extracteur : la pastille doit
  // déjà être là avant le geste de l'utilisateur. Aucun avertissement de plus,
  // la bulle de sélection réclame déjà <all_urls>.
  matches: ["<all_urls>"],
  // Pas d'`allFrames` (défaut : frame principale) : une pastille par page, là
  // où la bulle de sélection en veut une par iframe.
  async main(ctx) {
    let reading = false
    let paused = false
    /** Position de lecture : le bloc en cours, et où la voix en est dedans. */
    let blocks: string[] = []
    let blockIndex = 0
    let charIndex = 0
    let lang: string | undefined
    /**
     * Numéro de la file en cours.
     *
     * Relancer la lecture passe par `cancel()`, qui fait remonter un `end` sur
     * l'utterance coupée — indistinguable d'une fin naturelle. Chaque file
     * garde le numéro qu'elle avait à sa création : celle qui n'est plus la
     * courante sait que son `end` est un contrecoup et ne replie pas la
     * pastille.
     */
    let generation = 0
    /** Un réglage a changé pendant la pause : à appliquer à la reprise. */
    let stale = false
    /**
     * La lecture en cours utilise Supertonic plutôt que le moteur système.
     *
     * `blocks`/`blockIndex`/`charIndex`/`generation`/`stale` ne servent qu'au
     * chemin système : l'hôte Supertonic garde sa propre position, jamais
     * exposée ici — juste des événements `TTS_EVENT` à répercuter sur la
     * pastille.
     */
    let usingSupertonic = false
    /** Réinjecté à chaque `playing` : un état de chargement y écrit la
     *  progression du téléchargement par-dessus, il faut de quoi le restaurer. */
    let supertonicTitle = ""
    const token = Math.random().toString(36).slice(2)
    // Réassigné, pas figé : une lecture doit partir sur les réglages du moment,
    // y compris ceux changés depuis un autre onglet.
    let prefs = await loadPrefs()

    const pill = createPill(onPrimary, onSecondary, prefs)

    browser.runtime.onMessage.addListener(onMessage)
    browser.runtime.onMessage.addListener(onTtsEvent)
    browser.storage.onChanged.addListener(onTokenChanged)
    const unsubscribePrefs = onPrefsChanged((newPrefs) => {
      const speedChanged = newPrefs.speed !== prefs.speed
      const voiceChanged = newPrefs.voiceURI !== prefs.voiceURI
      prefs = newPrefs
      pill.updatePrefs(newPrefs)
      if (!reading) return

      if (usingSupertonic) {
        // La vitesse s'applique tout de suite (audio.playbackRate, jamais de
        // resynthèse) : aucune raison d'attendre la reprise, contrairement au
        // chemin système.
        //
        // ponytail: un changement de voix Supertonic en cours de lecture
        // n'est pas repris à la volée — l'hôte ne garde pas de position dans
        // le texte pour relancer avec une autre voix. Arrêter puis relire
        // pour l'entendre.
        if (speedChanged) {
          void browser.runtime.sendMessage({
            type: TTS_SET_SPEED,
            speed: newPrefs.speed,
          } satisfies TtsSetSpeedMessage)
        }
        return
      }

      if (!speedChanged && !voiceChanged) return
      // La synthèse ne réaccorde pas un utterance déjà lancé : le seul moyen
      // d'entendre la nouvelle vitesse est de refaire la file à partir du mot
      // en cours. En pause, on attend la reprise plutôt que de repartir tout
      // seul — `cancel()` déferait la pause.
      if (paused) stale = true
      else speak()
    })
    // La synthèse survit au déchargement de la page : sans ça la lecture
    // continue après un rechargement, hors de portée de la nouvelle pastille.
    // Pour Supertonic, `tabs.onRemoved` ne couvre que la fermeture de
    // l'onglet — un rechargement le laisse ouvert, donc sans ce signal
    // l'audio continuerait indéfiniment, sans plus aucune pastille pour
    // l'arrêter : le même risque que l'onglet fermé, côté rechargement.
    ctx.addEventListener(window, "pagehide", () => {
      if (!reading) return
      if (usingSupertonic) {
        void browser.runtime.sendMessage({ type: TTS_CONTROL, action: "stop" } satisfies TtsControlMessage)
      } else {
        cancelSpeech()
      }
    })
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.runtime.onMessage.removeListener(onTtsEvent)
      browser.storage.onChanged.removeListener(onTokenChanged)
      unsubscribePrefs()
      cancelSpeech()
      pill.remove()
    })

    function onMessage(message: Partial<StartReadingMessage>) {
      if (message?.type !== START_READING || !message.text) return
      start(message as ReadPagePayload)
    }

    /** Événements de l'hôte Supertonic : pilotent directement la pastille. */
    function onTtsEvent(message: Partial<TtsEventMessage>) {
      if (message?.type !== TTS_EVENT || !message.state) return
      const state = message.state
      if (state.phase === "loading") {
        // Le toast ne sort que pour une attente étiquetée : téléchargement du
        // modèle, chargement du moteur ou de la voix, et — pendant la lecture
        // — le hoquet où le bloc suivant n'a pas fini de se synthétiser (RTF
        // > 1, voir tts-host.ts). Les transitions déjà prêtes, elles, sont
        // instantanées et n'émettent jamais cet état.
        pill.setState(
          "loading",
          state.label ?? supertonicTitle,
          true,
          state.label ? { label: state.label, percent: state.progress } : undefined
        )
      } else if (state.phase === "playing") {
        paused = false
        pill.setState("playing", supertonicTitle)
      } else if (state.phase === "paused") {
        paused = true
        pill.setState("paused")
      } else if (state.phase === "ended") {
        fold()
      } else if (state.phase === "error") {
        void browser.runtime.sendMessage({
          type: NOTIFY,
          message: state.message,
        } satisfies NotifyMessage)
        fold()
      }
    }

    /** Un autre onglet a pris la parole : se replier, sans toucher au moteur. */
    function onTokenChanged(changes: Record<string, { newValue?: unknown }>) {
      const owner = changes[READER_TOKEN]?.newValue
      if (owner === undefined || owner === token || !reading) return
      fold()
    }

    /** ▶ lance la lecture, ⏸/▶ la met en pause et la reprend. */
    async function onPrimary() {
      if (reading) {
        // Notre propre drapeau, jamais `speechSynthesis.paused` : Chrome ne met
        // le sien à jour qu'après coup, on relirait l'état d'avant le clic.
        paused = !paused
        if (usingSupertonic) {
          // Retour immédiat, comme le chemin système : le TTS_EVENT qui suit
          // ne fait que confirmer le même état, sans le faire attendre.
          pill.setState(paused ? "paused" : "playing")
          void browser.runtime.sendMessage({
            type: TTS_CONTROL,
            action: paused ? "pause" : "resume",
          } satisfies TtsControlMessage)
          return
        }
        if (paused) speechSynthesis.pause()
        // La file en attente porte encore l'ancienne vitesse : la refaire plutôt
        // que la reprendre, sinon le réglage change au bloc suivant seulement.
        else if (stale) {
          stale = false
          speak()
        } else speechSynthesis.resume()
        pill.setState(paused ? "paused" : "playing")
        return
      }

      pill.setState("loading")
      // Un rejet (background endormi, onglet non injectable) vaut un échec :
      // sans ça la pastille resterait bloquée sur son état d'attente.
      const started = await browser.runtime
        .sendMessage({ type: READ_PAGE })
        .catch(() => false)
      // La réponse peut arriver après START_READING : ne redescendre à l'état
      // replié que si rien n'a démarré.
      if (!started && !reading) pill.setState("idle")
    }

    /** ⏹ pendant la lecture, ✕ au repos : masquer jusqu'au rechargement. */
    function onSecondary() {
      if (reading) stop()
      else pill.remove()
    }

    /** Choisit le moteur, puis démarre — le reste ne se recroise plus. */
    function start(payload: ReadPagePayload) {
      if (prefs.engine === "supertonic") {
        const supertonicLang = toSupertonicLang(payload.lang ?? "")
        if (supertonicLang) {
          startSupertonic(payload, supertonicLang)
          return
        }
        // Langue hors du modèle : un repli silencieux serait déroutant — dire
        // pourquoi la voix système est utilisée à sa place.
        void browser.runtime.sendMessage({
          type: NOTIFY,
          message: "Langue non prise en charge par Supertonic : lecture avec la voix système.",
        } satisfies NotifyMessage)
      }
      startSystem(payload)
    }

    function startSupertonic(payload: ReadPagePayload, lang: SupportedLang) {
      // Même annonce de titre qu'en système (buildReadingIntro), composée ici
      // plutôt que par l'hôte : lib/tts-host.ts ne connaît ni onglets ni titres,
      // seulement du texte à synthétiser.
      const intro = buildReadingIntro(payload.lang ?? "", payload.title ?? "")
      const text = intro ? `${intro} ${payload.text}` : payload.text

      usingSupertonic = true
      reading = true
      paused = false
      supertonicTitle = payload.title ?? ""
      void browser.storage.local.set({ [READER_TOKEN]: token })
      pill.attach()
      pill.setState("loading", supertonicTitle, true)
      void browser.runtime.sendMessage({
        type: TTS_SPEAK,
        text,
        title: payload.title,
        lang,
        voice: prefs.supertonicVoice,
        speed: prefs.speed,
        token,
      } satisfies Partial<TtsSpeakMessage>)
    }

    function startSystem(payload: ReadPagePayload) {
      // Un bloc par paragraphe, pour éviter la limite de longueur de Chrome.
      // Le découpage passe avant `expandText`, qui écrase les blancs — les
      // frontières de paragraphes n'y survivraient pas.
      const raw = payload.text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)

      // Le titre n'est pas dans le texte extrait — Readability retire le h1 qui
      // le répète. L'annoncer en tête du premier bloc plutôt qu'en bloc à part :
      // il suit alors la même reprise que le reste, comme sur mobile.
      const intro = buildReadingIntro(payload.lang ?? "", payload.title ?? "")
      if (intro && raw.length) raw[0] = `${intro} ${raw[0]}`

      // Texte à dire, jamais à afficher : sigles épelés, symboles verbalisés,
      // anglicismes réécrits pour les voix système. Ce sont les seules
      // disponibles ici, donc la couche phonétique s'applique toujours.
      blocks = raw.map((block) => expandText(block, { language: payload.lang })).filter(Boolean)
      if (!blocks.length) return fold()

      blockIndex = 0
      charIndex = 0
      lang = payload.lang
      reading = true
      paused = false
      stale = false
      // Prendre la parole : les pastilles des autres onglets s'en déduisent.
      void browser.storage.local.set({ [READER_TOKEN]: token })
      // La pastille a pu être masquée : une lecture lancée depuis le menu
      // contextuel doit quand même offrir de quoi l'arrêter.
      pill.attach()
      pill.setState("playing", payload.title ?? "")
      speak()
    }

    /**
     * Met en file ce qu'il reste à lire, aux réglages du moment.
     *
     * Appelée au démarrage comme à chaque changement de vitesse ou de voix :
     * dans les deux cas on repart de `blockIndex`/`charIndex`, donc du mot où
     * la voix en était.
     */
    function speak() {
      const mine = ++generation
      cancelSpeech()

      // Résolue une fois pour toute la file : `getVoices()` reconstruit sa
      // liste à chaque appel. Introuvable (voix désinstallée, autre machine)
      // vaut défaut.
      const voice = prefs.voiceURI
        ? speechSynthesis.getVoices().find((v) => v.voiceURI === prefs.voiceURI)
        : undefined

      const queue = blocks.slice(blockIndex).map((block, offset) => {
        // Seul le premier bloc reprend en cours de route ; les suivants sont
        // entiers, et leurs positions repartent donc de zéro.
        const from = offset === 0 ? charIndex : 0
        const at = blockIndex + offset
        const utterance = new SpeechSynthesisUtterance(block.slice(from))
        if (lang) utterance.lang = lang
        utterance.rate = prefs.speed
        if (voice) utterance.voice = voice

        utterance.addEventListener("start", () => {
          blockIndex = at
          charIndex = from
        })
        // `charIndex` est compté depuis le début de l'utterance, donc depuis le
        // reste du bloc : le rebaser sur le bloc entier, sinon une deuxième
        // reprise repartirait trop tôt.
        //
        // ponytail: les voix distantes n'émettent pas toujours `boundary`. Sans
        // lui la position reste au dernier départ, et changer la vitesse fait
        // reprendre le bloc courant depuis là — jamais plus loin que ça.
        utterance.addEventListener("boundary", (event) => {
          charIndex = from + event.charIndex
        })
        return utterance
      })

      // Se replier sans annuler : la file est déjà vide en fin naturelle, et si
      // l'événement vient d'un autre onglet qui nous a coupés, annuler ici
      // tuerait *sa* lecture.
      //
      // ponytail: la fin n'est détectée que sur le dernier bloc — si celui-ci
      // erre au lieu de finir, la pastille reste dépliée jusqu'au clic sur ⏹.
      queue.at(-1)?.addEventListener("end", () => {
        if (mine === generation) fold()
      })
      for (const utterance of queue) speechSynthesis.speak(utterance)
    }

    /** ⏹ : couper le moteur, puis se replier. */
    function stop() {
      if (usingSupertonic) {
        void browser.runtime.sendMessage({
          type: TTS_CONTROL,
          action: "stop",
        } satisfies TtsControlMessage)
      } else {
        cancelSpeech()
      }
      fold()
    }

    /** Revenir au repos sans toucher au moteur de synthèse. */
    function fold() {
      reading = false
      paused = false
      stale = false
      usingSupertonic = false
      // La file coupée ne nous appartient plus : un `end` en retard ne doit pas
      // replier une lecture relancée entre-temps.
      generation++
      pill.setState("idle")
    }
  },
})

/**
 * Annule la synthèse en cours.
 *
 * Chrome garde sa file quand on annule une lecture en pause : elle repart au
 * `speak()` suivant. Reprendre avant d'annuler la vide pour de bon.
 */
function cancelSpeech() {
  speechSynthesis.resume()
  speechSynthesis.cancel()
}

const HOST_STYLE =
  "all:initial!important;position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important"

const PILL_CSS = `
.pill-row {
  /*
   * Palette posée ici et pas sur :host — le HOST_STYLE inline porte un
   * all:initial!important qui écraserait tout ce qu'on y déclarerait.
   * Le popover en hérite : une seule matière pour les deux.
   */
  --bg: #111827;
  --fg: #fff;
  --muted: #9ca3af;
  --line: rgb(255 255 255 / 0.14);
  --accent: #60a5fa;
  /* Fait rendre le menu déroulant natif du select et le curseur en sombre.
     Deux propriétés au lieu d'un select réimplémenté. */
  color-scheme: dark;
  accent-color: var(--accent);

  display: inline-flex;
  align-items: center;
  padding: 6px;
  border-radius: 999px;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg);
  background: var(--bg);
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.28);
  position: relative;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}
button:hover:not(:disabled) { background: rgb(255 255 255 / 0.12) }
button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px }
button:disabled { opacity: 0.55; cursor: default }
/* Le pressé doit s'entendre tout de suite : le retour est sur l'appui, pas au
   relâchement. */
button:active:not(:disabled) { transform: scale(0.97) }
button { transition: transform 100ms cubic-bezier(0.23, 1, 0.32, 1) }
/*
 * "…" a très peu d'encre au-dessus de sa ligne de base contrairement aux
 * autres glyphes du bouton (▶ ✕ ⏸ ⏹) : centré comme eux par le flex du
 * bouton, il paraît quand même planté en bas. Mesuré à measureText() dans la
 * police système à 15px : ~4px d'écart entre son encre et celle des autres.
 */
.loading-glyph { display: inline-block; transform: translateY(-4px) }
/*
 * Icône en masque plutôt qu'en emoji : ⚙️ est rendu en couleur et à une chasse
 * différente sur chaque OS. Le masque suit currentColor, donc l'état désactivé
 * et le focus restent cohérents avec les autres boutons, et rien n'entre dans le
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
button[data-icon="sliders"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 7h5M15 7h5M4 12h9M19 12h1M4 17h3M13 17h7'/%3E%3Ccircle cx='12' cy='7' r='2.5'/%3E%3Ccircle cx='16' cy='12' r='2.5'/%3E%3Ccircle cx='10' cy='17' r='2.5'/%3E%3C/svg%3E");
}
/*
 * Au repos la pastille se replie sur ses deux boutons : le titre garde son
 * texte mais tombe à une largeur nulle. Une largeur n'a pas d'équivalent en
 * transform — même exception que pour un accordéon.
 */
span {
  max-width: 0;
  margin: 0;
  opacity: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    max-width 200ms cubic-bezier(0.23, 1, 0.32, 1),
    margin 200ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
:host([data-expanded]) span {
  max-width: 220px;
  margin: 0 6px;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  span { transition: opacity 120ms ease-out }
}
.settings-popover {
  position: absolute;
  bottom: 100%;
  right: 0;
  /* Même fond que la pastille : le popover en est le prolongement, pas une
     surface étrangère posée dessus. Le liseré clair fait l'arête. */
  background: var(--bg);
  border-radius: 10px;
  border: 1px solid var(--line);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.45);
  padding: 12px;
  min-width: 210px;
  color: var(--fg);
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.95) translateY(4px);
  /* Un popover s'ouvre depuis ce qui l'a ouvert : sans ça il grandit depuis son
     centre et le lien avec le bouton se perd. */
  transform-origin: bottom right;
  transition:
    opacity 150ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
  z-index: 10000;
  margin-bottom: 8px;
}
@media (prefers-reduced-motion: reduce) {
  .settings-popover { transform: none; transition: opacity 120ms ease-out }
  .settings-popover[data-open] { transform: none }
  button:active:not(:disabled) { transform: none }
}
.settings-popover[data-open] {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1) translateY(0);
}
/*
 * Pastille jumelle, pas un popover : même hauteur de ligne que .pill-row,
 * mêmes bouts entièrement arrondis. Dockée à gauche — c'est là qu'il reste de
 * la place, la pastille principale étant déjà plaquée contre le bord droit de
 * l'écran — et sort vers la gauche depuis ce point d'ancrage.
 */
.loading-toast {
  position: absolute;
  top: 50%;
  right: 100%;
  margin-right: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg);
  border-radius: 999px;
  border: 1px solid var(--line);
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.28);
  padding: 6px 14px 6px 10px;
  max-width: 220px;
  color: var(--fg);
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%) scale(0.95) translateX(12px);
  transform-origin: center right;
  transition:
    opacity 150ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
  z-index: 10000;
}
.loading-toast[data-open] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(-50%) scale(1) translateX(0);
}
@media (prefers-reduced-motion: reduce) {
  .loading-toast { transform: translateY(-50%); transition: opacity 120ms ease-out }
  .loading-toast[data-open] { transform: translateY(-50%) }
}
.loading-toast-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Anneau tournant : attente sans pourcentage connu (moteur, voix). */
.loading-toast-spinner {
  display: none;
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 999px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  animation: loading-spin 700ms linear infinite;
}
.loading-toast[data-mode="indeterminate"] .loading-toast-spinner { display: block }
@media (prefers-reduced-motion: reduce) {
  .loading-toast-spinner { animation-duration: 1400ms }
}
@keyframes loading-spin {
  to { transform: rotate(360deg) }
}
/* Barre déterminée : pourcentage connu (téléchargement du modèle). */
.loading-toast-bar {
  display: none;
  width: 48px;
  height: 4px;
  flex: none;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.loading-toast[data-mode="determinate"] .loading-toast-bar { display: block }
.loading-toast-bar-fill {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: left;
  background: var(--accent);
  transition: transform 150ms linear;
}
.settings-row { display: flex; flex-direction: column; gap: 6px }
.settings-row + .settings-row { margin-top: 12px }
.settings-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  font-weight: 600;
  cursor: pointer;
}
/* La valeur vit dans l'intitulé, à droite : elle appartient au réglage, pas à
   une ligne de plus. Chasse fixe pour que 1,0× et 1,2× ne la fassent pas
   sauter d'un pixel à chaque cran. */
.settings-value {
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.settings-control {
  width: 100%;
  font: inherit;
  font-size: 12px;
  color: var(--fg);
  cursor: pointer;
}
select.settings-control {
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgb(255 255 255 / 0.06);
  /* Un select natif tronque tout seul ; sans ça un nom de voix à rallonge
     élargit le popover jusqu'à le sortir de l'écran. */
  max-width: 100%;
}
select.settings-control:hover { background: rgb(255 255 255 / 0.12) }
input.settings-control { margin: 2px 0 }
.settings-control:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
/* Le coût du premier ▶ Supertonic, collé à la ligne Moteur — c'est ce qui le
   rend acceptable plutôt que subi. Masqué par défaut : afficher un [hidden]
   coûte moins qu'un état de plus dans syncControls(). */
.settings-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--muted);
}
.settings-note strong { color: var(--fg); font-weight: 600 }
`

/** Libellé et intitulé accessible de chaque bouton, état par état. */
const LABELS: Record<PillState, { primary: string; secondary: string }> = {
  idle: { primary: "▶", secondary: "✕" },
  loading: { primary: "…", secondary: "✕" },
  playing: { primary: "⏸", secondary: "⏹" },
  paused: { primary: "▶", secondary: "⏹" },
}

const ARIA: Record<PillState, { primary: string; secondary: string }> = {
  idle: { primary: "Lire cette page avec Orateur", secondary: "Masquer Orateur sur cette page" },
  loading: { primary: "Extraction de l'article…", secondary: "Masquer Orateur sur cette page" },
  playing: { primary: "Mettre en pause", secondary: "Arrêter la lecture" },
  paused: { primary: "Reprendre la lecture", secondary: "Arrêter la lecture" },
}

/**
 * Pastille flottante, dans un shadow root fermé — même isolation que la bulle
 * de sélection, pour les mêmes raisons.
 */
function createPill(
  onPrimary: () => void,
  onSecondary: () => void,
  initialPrefs: ReaderPreferences
) {
  const host = document.createElement("orateur-reader-pill")
  host.style.cssText = HOST_STYLE

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = PILL_CSS
  root.append(style)

  const row = document.createElement("div")
  row.className = "pill-row"
  const primary = button(onPrimary)
  // "…" a très peu d'encre au-dessus de sa ligne de base (contrairement à
  // ▶ ✕ ⏸ ⏹, qui s'équilibrent entre eux) : centré par le flex du bouton
  // comme les autres, il paraît quand même planté en bas. Un nudge isolé sur
  // cet élément plutôt que sur `primary` — son propre `transform` sert déjà
  // au retour d'appui (:active), les deux se marcheraient dessus sinon.
  const loadingGlyph = document.createElement("div")
  loadingGlyph.className = "loading-glyph"
  loadingGlyph.textContent = "…"
  const label = document.createElement("span")
  const secondary = button(onSecondary)
  const settings = button(() => togglePopover())
  // Posé une fois : l'icône et son intitulé ne dépendent pas de l'état de
  // lecture, contrairement à ceux de ▶ et ⏹.
  settings.dataset.icon = "sliders"
  settings.setAttribute("aria-label", "Réglages de lecture")
  settings.setAttribute("aria-expanded", "false")
  // Replié : ▶ ⚙ ✕. Le titre s'ouvre entre ▶ et ⚙ pendant la lecture, donc les
  // deux boutons de bord ne bougent pas quand la pastille se déplie.
  row.append(primary, label, settings, secondary)
  root.append(row)

  // Construit une fois, jamais réécrit : `innerHTML` est refusé par les pages
  // en `require-trusted-types-for 'script'` (Google, GitHub…), et un re-rendu
  // à chaque clic ferait perdre le focus clavier.
  const popover = document.createElement("div")
  popover.className = "settings-popover"
  popover.setAttribute("role", "group")
  popover.setAttribute("aria-label", "Réglages de lecture")
  row.append(popover)

  /**
   * Toast d'attente : téléchargement du modèle, chargement du moteur ou de
   * la voix Supertonic. Séparé de `label` (qui porte le titre de l'article)
   * pour ne jamais l'écraser — sans ça la pastille perdrait le titre affiché
   * pendant l'attente et devrait le retrouver au retour à "playing".
   */
  const toast = document.createElement("div")
  toast.className = "loading-toast"
  toast.setAttribute("role", "status")
  toast.setAttribute("aria-live", "polite")
  // `div`, pas `span` : la règle `span { max-width: 0; opacity: 0 }` plus bas
  // (le label replié de la pastille) écraserait silencieusement ces deux-là.
  const toastSpinner = document.createElement("div")
  toastSpinner.className = "loading-toast-spinner"
  toastSpinner.setAttribute("aria-hidden", "true")
  const toastLabel = document.createElement("div")
  toastLabel.className = "loading-toast-label"
  const toastBar = document.createElement("div")
  toastBar.className = "loading-toast-bar"
  const toastFill = document.createElement("div")
  toastFill.className = "loading-toast-bar-fill"
  toastBar.append(toastFill)
  toast.append(toastSpinner, toastLabel, toastBar)
  row.append(toast)

  let currentPrefs = initialPrefs
  let isPopoverOpen = false

  const engine = document.createElement("select")
  settingsRow("Moteur", engine)
  for (const [value, text] of ENGINES) {
    const choice = document.createElement("option")
    choice.value = value
    choice.textContent = text
    engine.append(choice)
  }
  engine.addEventListener("change", () => {
    savePrefs({ engine: engine.value as ReaderEngine })
    // currentPrefs n'a pas encore le nouveau moteur — l'écriture passe par un
    // aller-retour storage — mais le select Voix doit changer de liste tout
    // de suite, pas attendre onPrefsChanged.
    currentPrefs = { ...currentPrefs, engine: engine.value as ReaderEngine }
    renderVoices()
  })

  // Le coût du premier ▶ : Supertonic ne télécharge rien tant qu'on ne lit
  // pas, mais le dire à l'avance rend ce coût acceptable plutôt que subi.
  //
  // ponytail: texte statique, pas d'état « déjà téléchargé » — la pastille
  // n'a aucun moyen d'interroger l'OPFS de l'extension pour le savoir sans un
  // aller-retour de plus. La progression réelle, elle, passe par le libellé
  // de la pastille (setState("loading", "Téléchargement… 42%")) une fois la
  // lecture lancée.
  const supertonicNote = document.createElement("div")
  supertonicNote.className = "settings-note"
  const noteLead = document.createElement("strong")
  noteLead.textContent = "Voix naturelles, générées sur votre appareil."
  const noteRest = document.createElement("div")
  noteRest.textContent = "398 Mo à télécharger à la première lecture, une seule fois."
  supertonicNote.append(noteLead, noteRest)
  popover.append(supertonicNote)

  const speed = document.createElement("input")
  const speedValue = settingsRow("Vitesse", speed)
  speed.type = "range"
  speed.min = String(SPEED.min)
  speed.max = String(SPEED.max)
  speed.step = String(SPEED.step)
  // `input` pour le retour, `change` pour l'écriture : le chiffre suit le
  // pouce tout au long du geste, mais on n'écrit dans le storage qu'au
  // relâchement — sinon c'est une écriture par pixel parcouru.
  speed.addEventListener("input", () => {
    speedValue.textContent = formatSpeed(speed.valueAsNumber)
  })
  speed.addEventListener("change", () => savePrefs({ speed: speed.valueAsNumber }))

  const voice = document.createElement("select")
  settingsRow("Voix", voice)
  voice.addEventListener("change", () => {
    if (currentPrefs.engine === "supertonic") {
      savePrefs({ supertonicVoice: voice.value as SupertonicVoice })
    } else {
      // La valeur vide porte « laisser le navigateur choisir » : un select
      // n'a pas de null, et c'est aussi ce sur quoi il retombe si la voix
      // enregistrée a disparu de la machine.
      savePrefs({ voiceURI: voice.value || null })
    }
  })
  renderVoices()
  // Chrome charge ses voix après coup : sans cet événement la liste reste
  // réduite à « Par défaut » pendant les premières secondes de la page.
  speechSynthesis.addEventListener("voiceschanged", renderVoices)

  // Le shadow root ne voit pas les clics du reste de la page — l'écouteur doit
  // être sur le document. En capture, pour survivre à un `stopPropagation`.
  const onDocumentClick = (event: Event) => {
    if (isPopoverOpen && !event.composedPath().includes(row)) closePopover()
  }
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !isPopoverOpen) return
    closePopover()
    settings.focus()
  }
  document.addEventListener("click", onDocumentClick, true)
  document.addEventListener("keydown", onDocumentKeydown, true)

  /**
   * Pose un réglage dans le popover : intitulé à gauche, valeur lue à droite,
   * contrôle dessous. Le `<label>` rend l'intitulé cliquable, donc la cible de
   * pointage du réglage fait toute la largeur.
   */
  function settingsRow(title: string, control: HTMLElement) {
    const id = `orateur-${title.toLowerCase()}`
    control.id = id
    control.className = "settings-control"

    const container = document.createElement("div")
    container.className = "settings-row"
    const heading = document.createElement("label")
    heading.className = "settings-label"
    heading.htmlFor = id
    const name = document.createElement("span")
    name.textContent = title
    const value = document.createElement("span")
    value.className = "settings-value"
    heading.append(name, value)
    container.append(heading, control)
    popover.append(container)
    return value
  }

  /** Reflète les préférences en cours sur les contrôles déjà en place. */
  function syncControls() {
    engine.value = currentPrefs.engine
    speed.value = String(currentPrefs.speed)
    speedValue.textContent = formatSpeed(currentPrefs.speed)
    if (currentPrefs.engine === "supertonic") {
      voice.value = currentPrefs.supertonicVoice
    } else {
      // Une voix absente de la liste — désinstallée, ou enregistrée sur une
      // autre machine — laisse le select retomber sur l'option vide, qui est
      // justement le défaut. Rien à rattraper.
      voice.value = currentPrefs.voiceURI ?? ""
    }
    supertonicNote.hidden = currentPrefs.engine !== "supertonic"
  }

  function renderVoices() {
    if (currentPrefs.engine === "supertonic") {
      voice.replaceChildren(...SUPERTONIC_VOICE_OPTIONS.map(([id, label]) => voiceChoice(id, label)))
      syncControls()
      return
    }
    const choices = [voiceChoice("", "Par défaut")]
    // Aucun tri ni filtre par langue : deviner la bonne, c'est risquer de
    // masquer celle que l'utilisateur veut. Le select natif défile seul.
    for (const available of speechSynthesis.getVoices()) {
      choices.push(voiceChoice(available.voiceURI, `${available.name} (${available.lang})`))
    }
    voice.replaceChildren(...choices)
    syncControls()
  }

  function closePopover() {
    isPopoverOpen = false
    popover.removeAttribute("data-open")
    settings.setAttribute("aria-expanded", "false")
  }

  function togglePopover() {
    isPopoverOpen = !isPopoverOpen
    popover.toggleAttribute("data-open", isPopoverOpen)
    settings.setAttribute("aria-expanded", String(isPopoverOpen))
    if (isPopoverOpen) syncControls()
  }

  function attach() {
    // `body` est absent d'un document XML ou SVG.
    if (!host.isConnected) (document.body ?? document.documentElement).append(host)
  }

  attach()
  setState("idle")

  function setState(
    state: PillState,
    title?: string,
    interruptible = false,
    toastInfo?: { label: string; percent?: number }
  ) {
    if (state === "loading") primary.replaceChildren(loadingGlyph)
    else primary.textContent = LABELS[state].primary
    primary.setAttribute("aria-label", ARIA[state].primary)
    secondary.textContent = LABELS[state].secondary
    secondary.setAttribute("aria-label", ARIA[state].secondary)
    // Rien à annuler tant que l'extraction tourne : quelques centaines de
    // millisecondes, plus simple à neutraliser qu'à interrompre. Supertonic
    // réutilise ce même état "loading" pour des attentes de plusieurs
    // secondes (téléchargement, synthèse entre blocs) — `interruptible` en
    // sort les deux appelants concernés, sinon ⏸/⏹ resteraient morts
    // précisément quand l'utilisateur veut s'en servir.
    primary.disabled = secondary.disabled = state === "loading" && !interruptible
    // Le titre n'est réécrit que quand on en fournit un : une pause ne doit
    // pas le perdre — donc pas replier la pastille — juste changer l'icône.
    if (title !== undefined) label.textContent = title
    host.toggleAttribute("data-expanded", state === "playing" || state === "paused")

    toast.toggleAttribute("data-open", toastInfo !== undefined)
    if (toastInfo) {
      toastLabel.textContent = toastInfo.label
      toast.dataset.mode = toastInfo.percent === undefined ? "indeterminate" : "determinate"
      if (toastInfo.percent !== undefined) toastFill.style.transform = `scaleX(${toastInfo.percent / 100})`
    }
  }

  return {
    attach,
    setState,
    remove: () => {
      document.removeEventListener("click", onDocumentClick, true)
      document.removeEventListener("keydown", onDocumentKeydown, true)
      speechSynthesis.removeEventListener("voiceschanged", renderVoices)
      host.remove()
    },
    updatePrefs: (prefs: ReaderPreferences) => {
      currentPrefs = prefs
      syncControls()
    },
  }
}

const ENGINES: Array<[ReaderEngine, string]> = [
  ["system", "Voix système"],
  ["supertonic", "Supertonic"],
]

/**
 * Les 10 voix Supertonic et leurs libellés français, dupliqués depuis
 * lib/supertonic/types.ts plutôt qu'importés : la valeur (pas juste son
 * type) ferait entrer le moteur dans ce bundle chargé sur toutes les pages.
 */
const SUPERTONIC_VOICE_OPTIONS: Array<[SupertonicVoice, string]> = [
  ["F1", "Femme 1"], ["F2", "Femme 2"], ["F3", "Femme 3"], ["F4", "Femme 4"], ["F5", "Femme 5"],
  ["M1", "Homme 1"], ["M2", "Homme 2"], ["M3", "Homme 3"], ["M4", "Homme 4"], ["M5", "Homme 5"],
]

function voiceChoice(value: string, text: string) {
  const choice = document.createElement("option")
  choice.value = value
  choice.textContent = text
  return choice
}

/** « 1,2× » — virgule décimale, et toujours une décimale pour ne pas sauter. */
function formatSpeed(speed: number) {
  return `${speed.toFixed(1).replace(".", ",")}×`
}

function button(onClick: () => void) {
  const element = document.createElement("button")
  element.type = "button"
  // Le mousedown par défaut déplace le caret et efface une sélection en cours.
  element.addEventListener("mousedown", (event) => event.preventDefault())
  element.addEventListener("click", onClick)
  return element
}
