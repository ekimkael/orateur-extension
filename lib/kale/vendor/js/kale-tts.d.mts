import type * as ort from "onnxruntime-web"

export class KaleTTS {
  static load(base: string, options: {
    ort: typeof ort
    frontend: string
    readBytes: (path: string) => Promise<ArrayBuffer>
    graph: "int8" | "fp32"
    executionProviders: ("wasm" | "webgpu")[]
  }): Promise<KaleTTS>
  speak(text: string, options: { voice: string }): Promise<{ audio: Float32Array<ArrayBuffer>; sampleRate: number }>
}
