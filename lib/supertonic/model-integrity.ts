export const MODEL_REVISION = "3cadd1ee6394adea1bd021217a0e650ede09a323"

export const MODEL_HASHES: Readonly<Record<string, string>> = {
  "duration_predictor.onnx": "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
  "text_encoder.onnx": "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
  "tts.json": "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
  "unicode_indexer.json": "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f",
  "vector_estimator.onnx": "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
  "vocoder.onnx": "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
  "voice-F1.json": "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2",
  "voice-F2.json": "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6",
  "voice-F3.json": "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab",
  "voice-F4.json": "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b",
  "voice-F5.json": "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d",
  "voice-M1.json": "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b",
  "voice-M2.json": "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50",
  "voice-M3.json": "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b",
  "voice-M4.json": "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303",
  "voice-M5.json": "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2"
}

export const MODEL_SIZES: Readonly<Record<string, number>> = {
  "duration_predictor.onnx": 3700147,
  "text_encoder.onnx": 36416150,
  "tts.json": 8253,
  "unicode_indexer.json": 277676,
  "vector_estimator.onnx": 256534781,
  "vocoder.onnx": 101424195,
  "voice-F1.json": 292046,
  "voice-F2.json": 292423,
  "voice-F3.json": 290794,
  "voice-F4.json": 291808,
  "voice-F5.json": 291479,
  "voice-M1.json": 291748,
  "voice-M2.json": 292055,
  "voice-M3.json": 290198,
  "voice-M4.json": 291522,
  "voice-M5.json": 291469
}

export async function verifyModelFile(name: string, bytes: ArrayBuffer): Promise<void> {
  const expected = MODEL_HASHES[name]
  if (!expected || bytes.byteLength !== MODEL_SIZES[name]) throw new Error(`Invalid model size: ${name}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
  if (actual !== expected) throw new Error(`Model integrity check failed: ${name}`)
}
