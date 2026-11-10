import initialize, { Model, Tokenizer } from "./tts_wasm.js"

let model
let tokenizer
let cancelled = false
const voices = new Map()

async function synthesize(text, voice) {
  cancelled = false
  const [prepared, framesAfterEos] = model.prepare_text(text)
  model.start_generation(voices.get(voice), tokenizer.encode(prepared), framesAfterEos, 0.7)
  const chunks = []
  let size = 0
  for (let frames = 0; !cancelled; frames++) {
    // The bindings generate one frame per call. Yield to cancellation messages
    // without yielding between every frame on slower devices.
    if (frames % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    if (cancelled) break
    const chunk = model.generation_step()
    if (!chunk) break
    chunks.push(chunk)
    size += chunk.length
  }
  if (cancelled) {
    model.cancel_generation()
    return null
  }
  const pcm = new Float32Array(size)
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk, offset)
    offset += chunk.length
  }
  return pcm
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "cancel") {
      cancelled = true
    } else if (data.type === "initialize") {
      await initialize()
      tokenizer = new Tokenizer(new Uint8Array(data.tokenizer))
      model = new Model(new Uint8Array(data.weights), data.language)
      self.postMessage({ ok: true, sampleRate: model.sample_rate() })
    } else if (data.type === "voice") {
      voices.set(data.name, model.add_voice(new Uint8Array(data.bytes)))
      self.postMessage({ ok: true })
    } else if (data.type === "synthesize") {
      const pcm = await synthesize(data.text, data.voice)
      if (pcm) self.postMessage({ ok: true, pcm }, [pcm.buffer])
      else self.postMessage({ ok: false })
    }
  } catch {
    model?.cancel_generation()
    self.postMessage({ ok: false })
  }
}
