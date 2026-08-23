import { useEffect, useRef, useState } from "react"
import { useTranslation } from "../hooks/useTranslation"
import type { ReaderEngine } from "../lib/reader-prefs"
import type { SupertonicVoice } from "../lib/supertonic/types.ts"

interface VoicePreviewButtonProps {
  engine: ReaderEngine
  voiceURI: string | null
  supertonicVoice: SupertonicVoice
  /** Vitesse réglée : l'extrait se joue à ce rythme, pas à un rythme neutre. */
  speed: number
}

/**
 * Voix système : `speechSynthesis`, direct. Voix naturelles IA : un clip
 * pré-rendu (`public/voice-samples/<voix>.opus`) — jouable avant même que le
 * modèle Supertonic (398 Mo) ait été téléchargé, ce qui est précisément le
 * moment où on hésite entre les dix voix.
 */
export function VoicePreviewButton({ engine, voiceURI, supertonicVoice, speed }: VoicePreviewButtonProps) {
  const t = useTranslation()
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function stop() {
    speechSynthesis.cancel()
    audioRef.current?.pause()
    setPlaying(false)
  }

  // Changer de moteur ou de voix pendant un aperçu ne doit pas le laisser
  // continuer sur l'ancien choix ; le même cleanup couvre le démontage
  // (fermeture de l'onglet en plein aperçu).
  useEffect(() => stop, [engine, voiceURI, supertonicVoice])

  function playSystem() {
    const utterance = new SpeechSynthesisUtterance(t("optionsPreviewSampleText"))
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)
    if (voice) utterance.voice = voice
    utterance.rate = speed
    utterance.onend = () => setPlaying(false)
    utterance.onerror = () => setPlaying(false)
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
    setPlaying(true)
  }

  function playNaturalAI() {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.src = browser.runtime.getURL(`/voice-samples/${supertonicVoice}.opus`)
    audio.playbackRate = speed
    audio.onended = () => setPlaying(false)
    audio.onerror = () => setPlaying(false)
    setPlaying(true)
    void audio.play().catch(() => setPlaying(false))
  }

  function handleClick() {
    if (playing) {
      stop()
      return
    }
    if (engine === "supertonic") playNaturalAI()
    else playSystem()
  }

  return (
    <button
      type="button"
      className="btn-icon"
      data-playing={playing}
      onClick={handleClick}
      aria-label={t(playing ? "optionsStopPreview" : "optionsPreviewVoice")}
    >
      {playing ? (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
        </svg>
      )}
    </button>
  )
}
