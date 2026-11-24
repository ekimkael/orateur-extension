import type * as Ort from "onnxruntime-web"
import { KALE_FILES } from "../lib/kale/asset-files.ts"
import { KALE_GRAPHS, KALE_MODEL_DIR, hasKaleCpuGraph, loadKaleFile } from "../lib/kale/model-cache.ts"
import type { KaleRequest, KaleReply } from "../lib/kale/runtime.ts"
import { KaleTTS } from "../lib/kale/vendor/js/kale-tts.mjs"

/** Synthesize within an extension worker, leaving playback responsive. */
export default defineUnlistedScript(() => {
  const scope = self as unknown as {
    crossOriginIsolated: boolean
    location: Location
    navigator: { hardwareConcurrency: number; gpu?: { requestAdapter(): Promise<unknown> } }
    onmessage: (event: MessageEvent<KaleRequest>) => void
    postMessage(message: KaleReply, transfer?: Transferable[]): void
  }
  const signal = new AbortController().signal
  let model: KaleTTS | undefined
  let request: KaleRequest
  let cpuReserveBytes = 0
  const report = (message: KaleReply) => scope.postMessage(message)
  const readBytes = (path: string) => loadKaleFile(path, signal, (loaded, total) => {
    if (path.endsWith(".onnx")) {
      const completeBytes = path === KALE_GRAPHS.webgpu ? loaded + cpuReserveBytes : loaded
      const plannedBytes = request.webGpu ? KALE_FILES[KALE_GRAPHS.webgpu]![0] + cpuReserveBytes : total
      report({ phase: "downloading-model", progress: Math.floor(completeBytes * 100 / plannedBytes) })
    } else if (request.webGpu) report({ phase: "loading-engine" })
  }, request.cacheOnly)

  async function open() {
    if (request.webGpu) {
      const { gpu } = scope.navigator
      if (!await gpu?.requestAdapter()) throw new Error("WebGPU adapter unavailable")
      if (!await hasKaleCpuGraph()) {
        // Keep the fallback available once the faster graph has been installed.
        cpuReserveBytes = KALE_FILES[KALE_GRAPHS.wasm]![0]
        await readBytes(KALE_GRAPHS.wasm)
        if (!await hasKaleCpuGraph()) throw new Error("Could not retain the CPU fallback")
      }
    }
    const runtimePath = request.webGpu ? "./ort-kale/ort.webgpu.min.mjs" : "./ort/ort.bundle.min.mjs"
    const ortUrl = new URL(runtimePath, scope.location.href).href
    const ort = await import(/* @vite-ignore */ ortUrl) as typeof Ort
    ort.env.wasm.wasmPaths = new URL(".", ortUrl).href
    ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(4, scope.navigator.hardwareConcurrency || 1) : 1
    ort.env.wasm.proxy = false
    return KaleTTS.load(KALE_MODEL_DIR, {
      ort, frontend: "frontend", readBytes,
      graph: request.webGpu ? "fp32" : "int8",
      executionProviders: [request.webGpu ? "webgpu" : "wasm"],
    })
  }

  scope.onmessage = async ({ data }: MessageEvent<KaleRequest>) => {
    request = data
    try {
      model ??= await open()
      const { audio, sampleRate } = await model.speak(request.text, { voice: request.voice })
      scope.postMessage({ pcm: audio, sampleRate } satisfies KaleReply, [audio.buffer])
    } catch (error) {
      report({ error: error instanceof Error ? error.message : "Kale synthesis failed" })
    }
  }
})
