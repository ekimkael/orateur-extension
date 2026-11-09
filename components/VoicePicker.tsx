import { useEffect, useState } from "react"
import { useTranslation } from "../hooks/useTranslation"
import { VoicePreviewButton } from "./VoicePreviewButton"
import type { ReaderEngine } from "../lib/reader-prefs"
import { POCKET_VOICES, isPocketVoice, type PocketVoice } from "../lib/pocket/catalog.ts"
import { SUPERTONIC_VOICES, SUPERTONIC_VOICE_LABEL_KEYS, type SupertonicVoice } from "../lib/supertonic/types.ts"

interface VoicePickerProps {
  engine: ReaderEngine
  voiceURI: string | null
  supertonicVoice: SupertonicVoice
  pocketVoice: PocketVoice
  speed: number
  onChangeSystemVoice: (voiceURI: string | null) => void
  onChangeSupertonicVoice: (voice: SupertonicVoice) => void
  onChangePocketVoice: (voice: PocketVoice) => void
}

/** Selects a voice from the active engine's catalog. */
export function VoicePicker({
  engine,
  voiceURI,
  supertonicVoice,
  pocketVoice,
  speed,
  onChangeSystemVoice,
  onChangeSupertonicVoice,
  onChangePocketVoice,
}: VoicePickerProps) {
  const t = useTranslation()
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    function refresh() {
      setSystemVoices(speechSynthesis.getVoices())
    }
    refresh()
    // Chrome charge ses voix après coup — même repli que reader.content/.
    speechSynthesis.addEventListener("voiceschanged", refresh)
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh)
  }, [])

  const select =
    engine === "pocket" ? (
      <select
        aria-labelledby="voice-picker-label"
        value={pocketVoice}
        onChange={(e) => {
          if (isPocketVoice(e.target.value)) onChangePocketVoice(e.target.value)
        }}
      >
        {POCKET_VOICES.map((id) => (
          <option key={id} value={id}>
            {id === "auto" ? t("voicePocketAuto") : id[0]!.toUpperCase() + id.slice(1)}
          </option>
        ))}
      </select>
    ) : engine === "supertonic" ? (
      <select
        aria-labelledby="voice-picker-label"
        value={supertonicVoice}
        onChange={(e) => onChangeSupertonicVoice(e.target.value as SupertonicVoice)}
      >
        {SUPERTONIC_VOICES.map((id) => (
          <option key={id} value={id}>
            {t(SUPERTONIC_VOICE_LABEL_KEYS[id])}
          </option>
        ))}
      </select>
    ) : (
      <select
        aria-labelledby="voice-picker-label"
        value={voiceURI ?? ""}
        onChange={(e) => onChangeSystemVoice(e.target.value || null)}
      >
        <option value="">{t("voiceDefault")}</option>
        {systemVoices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
    )

  return (
    <div className="row">
      <span className="row-head">
        <span className="row-label" id="voice-picker-label">
          {t("settingsVoiceLabel")}
        </span>
      </span>
      <div className="voice-row">
        {select}
        {engine !== "pocket" && <VoicePreviewButton engine={engine} voiceURI={voiceURI} supertonicVoice={supertonicVoice} speed={speed} />}
      </div>
    </div>
  )
}
