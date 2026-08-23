import { useEffect, useState } from "react"
import type { ReaderEngine } from "../lib/reader-prefs"
import { SUPERTONIC_VOICES, SUPERTONIC_VOICE_LABEL_KEYS, type SupertonicVoice } from "../lib/supertonic/types.ts"

/**
 * Contrairement à reader.content.ts (content script sur `<all_urls>`), cette
 * page n'a aucune raison d'éviter l'import direct de lib/supertonic/types.ts :
 * elle ne charge qu'à l'ouverture des réglages, jamais sur toutes les pages.
 */
type MessageKey = Parameters<typeof browser.i18n.getMessage>[0]

interface VoicePickerProps {
  engine: ReaderEngine
  voiceURI: string | null
  supertonicVoice: SupertonicVoice
  onChangeSystemVoice: (voiceURI: string | null) => void
  onChangeSupertonicVoice: (voice: SupertonicVoice) => void
}

export function VoicePicker({
  engine,
  voiceURI,
  supertonicVoice,
  onChangeSystemVoice,
  onChangeSupertonicVoice,
}: VoicePickerProps) {
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

  if (engine === "supertonic") {
    return (
      <label className="settings-row">
        <span className="settings-label">{browser.i18n.getMessage("settingsVoiceLabel")}</span>
        <select
          value={supertonicVoice}
          onChange={(e) => onChangeSupertonicVoice(e.target.value as SupertonicVoice)}
        >
          {SUPERTONIC_VOICES.map((id) => (
            <option key={id} value={id}>
              {browser.i18n.getMessage(SUPERTONIC_VOICE_LABEL_KEYS[id] as MessageKey)}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <label className="settings-row">
      <span className="settings-label">{browser.i18n.getMessage("settingsVoiceLabel")}</span>
      <select value={voiceURI ?? ""} onChange={(e) => onChangeSystemVoice(e.target.value || null)}>
        <option value="">{browser.i18n.getMessage("voiceDefault")}</option>
        {systemVoices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
    </label>
  )
}
