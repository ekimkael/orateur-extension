/**
 * SPIKE PHASE 0 — jetable.
 *
 * Les mêmes contrôles, quel que soit l'hôte : document offscreen sur Chrome,
 * page de fond persistante sur Firefox MV2. Les résultats partent en HTTP vers
 * `scratchpad/sink.mjs` — ni une vue d'extension ni une page de fond ne
 * s'inspectent depuis l'extérieur, et recopier une console à la main n'est pas
 * une vérification.
 */
const SINK = "http://localhost:9998"
const HF = "https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx"

type Check = { ok: boolean; detail?: unknown }

export async function runSpikeChecks(hote: string) {
  const results: Record<string, Check> = {}
  const check = async (nom: string, fn: () => Promise<Check> | Check) => {
    try {
      results[nom] = await fn()
    } catch (e) {
      results[nom] = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  await check("1-crossOriginIsolated", () => ({
    ok: self.crossOriginIsolated === true,
    detail: self.crossOriginIsolated,
  }))
  await check("2-SharedArrayBuffer", () => ({
    ok: typeof SharedArrayBuffer === "function",
    detail: typeof SharedArrayBuffer,
  }))

  let ORT: any
  await check("3-import-ort", async () => {
    const url = browser.runtime.getURL("/ort/ort.bundle.min.mjs")
    ORT = await import(/* @vite-ignore */ url)
    return { ok: typeof ORT?.InferenceSession?.create === "function", detail: url }
  })

  await check("4-mime-worker-mjs", async () => {
    const r = await fetch(browser.runtime.getURL("/ort/ort-wasm-simd-threaded.jsep.mjs"))
    const type = r.headers.get("content-type")
    return { ok: !!type && /javascript|ecmascript/i.test(type), detail: { status: r.status, type } }
  })

  if (ORT) {
    // WXT type `getURL` sur les fichiers réellement présents dans public/ : un
    // dossier n'en est pas un. On dérive le chemin d'un fichier connu plutôt
    // que de forcer le type.
    ORT.env.wasm.wasmPaths = browser.runtime
      .getURL("/ort/ort.bundle.min.mjs")
      .replace(/[^/]+$/, "")
    const cores = navigator.hardwareConcurrency || 4
    // Sans isolation cross-origin (le cas de Firefox), un seul thread.
    ORT.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(2, Math.min(4, Math.floor(cores / 2)))
      : 1
    ORT.env.wasm.proxy = true
    await check("5-numThreads", () => ({
      ok: ORT.env.wasm.numThreads >= 1,
      detail: { numThreads: ORT.env.wasm.numThreads, cores },
    }))

    let modelBuf: ArrayBuffer | undefined
    await check("7-fetch-hf-sous-coep", async () => {
      const t = performance.now()
      const r = await fetch(`${HF}/duration_predictor.onnx`)
      modelBuf = await r.arrayBuffer()
      return {
        ok: r.ok && modelBuf.byteLength > 3_000_000,
        detail: { status: r.status, octets: modelBuf.byteLength, ms: Math.round(performance.now() - t) },
      }
    })

    // Le test qui décide : le build threadé s'instancie-t-il, et tourne-t-il ?
    // Sur Firefox c'est la question ouverte — pas de SharedArrayBuffer là-bas.
    await check("6-session-et-run", async () => {
      if (!modelBuf) return { ok: false, detail: "modèle non téléchargé" }
      const tc = performance.now()
      const sess = await ORT.InferenceSession.create(modelBuf, { executionProviders: ["wasm"] })
      const createMs = Math.round(performance.now() - tc)
      const N = 6
      const feeds = () => ({
        text_ids: new ORT.Tensor("int64", new BigInt64Array(N).fill(3n), [1, N]),
        style_dp: new ORT.Tensor("float32", new Float32Array(8 * 16), [1, 8, 16]),
        text_mask: new ORT.Tensor("float32", new Float32Array(N).fill(1), [1, 1, N]),
      })
      const t1 = performance.now()
      const out = await sess.run(feeds())
      const premierRunMs = Math.round(performance.now() - t1)
      const t2 = performance.now()
      await sess.run(feeds())
      return {
        ok: !!out?.duration,
        detail: {
          entrees: sess.inputNames,
          sorties: sess.outputNames,
          createMs,
          premierRunMs,
          secondRunMs: Math.round(performance.now() - t2),
        },
      }
    })
  }

  await check("8-audio-sans-geste", async () => {
    const n = 44100
    const wav = new Uint8Array(44 + n * 2)
    const dv = new DataView(wav.buffer)
    const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE")
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
    dv.setUint16(22, 1, true); dv.setUint32(24, 44100, true)
    dv.setUint32(28, 88200, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
    str(36, "data"); dv.setUint32(40, n * 2, true)
    const audio = new Audio(URL.createObjectURL(new Blob([wav], { type: "audio/wav" })))
    await audio.play()
    const playing = !audio.paused
    audio.pause()
    return { ok: playing, detail: { aJoue: playing } }
  })

  await check("9-storage-onChanged", async () => {
    if (!browser.storage?.local) return { ok: false, detail: "browser.storage indisponible" }
    const vu = new Promise<boolean>((resolve) => {
      const h = (c: Record<string, unknown>) => {
        if ("orateur:spike" in c) { browser.storage.onChanged.removeListener(h); resolve(true) }
      }
      browser.storage.onChanged.addListener(h)
      setTimeout(() => resolve(false), 3000)
    })
    await browser.storage.local.set({ "orateur:spike": Date.now() })
    return { ok: await vu }
  })

  // 12 — l'OPFS, où atterriront les ~400 Mo de modèles.
  await check("12-opfs", async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle("spike", { create: true })
    const fh = await dir.getFileHandle("t.bin", { create: true })
    const w = await fh.createWritable()
    await w.write(new Uint8Array([1, 2, 3]))
    await w.close()
    const taille = (await (await fh.getFile()).arrayBuffer()).byteLength
    await root.removeEntry("spike", { recursive: true })
    return { ok: taille === 3, detail: { octetsRelus: taille } }
  })

  const corps = JSON.stringify({ hote, quand: new Date().toISOString(), agent: navigator.userAgent, resultats: results }, null, 1)
  console.log("[spike]", corps)
  try {
    await fetch(`${SINK}/phase0-${hote}.json`, { method: "POST", body: corps })
  } catch (e) {
    console.error("[spike] récepteur injoignable", e)
  }

  // 10 — durée de vie de l'hôte.
  setTimeout(() => {
    void fetch(`${SINK}/phase0-${hote}-vivant-2min.json`, {
      method: "POST",
      body: JSON.stringify({ vivantApres: "2 min", a: new Date().toISOString() }),
    }).catch(() => {})
  }, 120_000)
}
