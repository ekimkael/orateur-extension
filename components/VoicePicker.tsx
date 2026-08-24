import { useEffect, useState } from "react"
import { useTranslation } from "../hooks/useTranslation"
import { VoicePreviewButton } from "./VoicePreviewButton"
import type { ReaderEngine } from "../lib/reader-prefs"
import { SUPERTONIC_VOICES, SUPERTONIC_VOICE_LABEL_KEYS, type SupertonicVoice } from "../lib/supertonic/types.ts"

interface VoicePickerProps {
  engine: ReaderEngine
  voiceURI: string | null
  supertonicVoice: SupertonicVoice
  speed: number
  onChangeSystemVoice: (voiceURI: string | null) => void
  onChangeSupertonicVoice: (voice: SupertonicVoice) => void
}

export function VoicePicker({
  engine,
  voiceURI,
  supertonicVoice,
  speed,
  onChangeSystemVoice,
  onChangeSupertonicVoice,
}: VoicePickerProps) {
  const t = useTranslation()
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    function refresh() {
      setSystemVoices(speechSynthesis.getVoices())
    }
    refresh()
    // Chrome charge ses voix après coup — même repli que reader.content.ts.
    speechSynthesis.addEventListener("voiceschanged", refresh)
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh)
  }, [])

  const select =
    engine === "supertonic" ? (
      <select value={supertonicVoice} onChange={(e) => onChangeSupertonicVoice(e.target.value as SupertonicVoice)}>
        {SUPERTONIC_VOICES.map((id) => (
          <option key={id} value={id}>
            {t(SUPERTONIC_VOICE_LABEL_KEYS[id])}
          </option>
        ))}
      </select>
    ) : (
      <select value={voiceURI ?? ""} onChange={(e) => onChangeSystemVoice(e.target.value || null)}>
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
        <span className="row-label">{t("settingsVoiceLabel")}</span>
      </span>
      <div className="voice-row">
        {select}
        <VoicePreviewButton engine={engine} voiceURI={voiceURI} supertonicVoice={supertonicVoice} speed={speed} />
      </div>
    </div>
  )
}
