import assert from "node:assert/strict"
import test from "node:test"
import { voiceOptions } from "./voice-options.ts"

test("Supertonic voices list the female voices first, each with its i18n key", () => {
  assert.deepEqual(voiceOptions("supertonic").map((option) => option.id),
    ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"])
  assert.deepEqual(voiceOptions("supertonic")[0], { id: "F1", key: "voiceFemale1" })
  assert.deepEqual(voiceOptions("supertonic")[5], { id: "M1", key: "voiceMale1" })
})

test("Pocket voices show their names, and translate only the automatic choice", () => {
  assert.deepEqual(voiceOptions("pocket"), [
    { id: "auto", key: "voicePocketAuto" },
    { id: "alba", text: "Alba" },
    { id: "estelle", text: "Estelle" },
  ])
})
