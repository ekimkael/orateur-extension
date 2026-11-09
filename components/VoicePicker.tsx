import { useEffect, useState } from "react"
import { useTranslation } from "../hooks/useTranslation"
import { VoicePreviewButton } from "./VoicePreviewButton"
import type { ReaderEngine } from "../lib/reader-prefs"
import { isPocketVoice, type PocketVoice } from "../lib/pocket/catalog.ts"
import type { SupertonicVoice } from "../lib/supertonic/types.ts"
import { voiceOptions } from "../lib/voice-options.ts"

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

  const localOptions = (local: "pocket" | "supertonic") => voiceOptions(local).map((option) => (
    <option key={option.id} value={option.id}>{"key" in option ? t(option.key) : option.text}</option>
  ))

  const select =
    engine === "pocket" ? (
      <select
        aria-labelledby="voice-picker-label"
        value={pocketVoice}
        onChange={(e) => {
          if (isPocketVoice(e.target.value)) onChangePocketVoice(e.target.value)
        }}
      >
        {localOptions("pocket")}
      </select>
    ) : engine === "supertonic" ? (
      <select
        aria-labelledby="voice-picker-label"
        value={supertonicVoice}
        onChange={(e) => onChangeSupertonicVoice(e.target.value as SupertonicVoice)}
      >
        {localOptions("supertonic")}
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
