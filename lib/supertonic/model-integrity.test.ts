import assert from "node:assert/strict"
import test from "node:test"
import { MODEL_HASHES, MODEL_REVISION, MODEL_SIZES, verifyModelFile } from "./model-integrity.ts"
import { ONNX_FILES, SUPERTONIC_VOICES, VOICE_STYLE_BASE } from "./types.ts"

test("all model and voice files have pinned hashes and sizes", () => {
  assert.match(MODEL_REVISION, /^[a-f0-9]{40}$/)
  const names = [...ONNX_FILES.map(file => file.name), ...SUPERTONIC_VOICES.map(voice => `voice-${voice}.json`)]
  assert.equal(names.length, 16)
  for (const name of names) {
    assert.match(MODEL_HASHES[name], /^[a-f0-9]{64}$/)
    assert.ok(MODEL_SIZES[name] > 0)
  }
  for (const file of ONNX_FILES) assert.ok(file.path.includes(`/resolve/${MODEL_REVISION}/`))
  assert.ok(VOICE_STYLE_BASE.includes(`/resolve/${MODEL_REVISION}/`))
})

test("verification rejects unknown names, wrong sizes, and wrong hashes", async () => {
  await assert.rejects(verifyModelFile("unknown", new ArrayBuffer(0)), /Invalid model size/)
  const name = "tts.json"
  const originalSize = MODEL_SIZES[name]
  const originalHash = MODEL_HASHES[name]
  try {
    ;(MODEL_SIZES as Record<string, number>)[name] = 3
    ;(MODEL_HASHES as Record<string, string>)[name] = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    await verifyModelFile(name, new TextEncoder().encode("abc").buffer)
    await assert.rejects(verifyModelFile(name, new TextEncoder().encode("ab").buffer), /Invalid model size/)
    await assert.rejects(verifyModelFile(name, new TextEncoder().encode("abd").buffer), /integrity check failed/)
  } finally {
    ;(MODEL_SIZES as Record<string, number>)[name] = originalSize
    ;(MODEL_HASHES as Record<string, string>)[name] = originalHash
  }
})
