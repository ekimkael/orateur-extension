// Le lock (concurrence), l'abandon (AbortSignal) et le manifeste combiné
// (ONNX + styles de voix) sont la logique branchante de ce jalon (1d) — donc
// ce qui a besoin d'un test, par la propre convention du projet (voir
// CLAUDE.md / ponytail : "Non-trivial logic ... leaves ONE runnable check").
//
// `readCachedVoiceStyle()` couvre ici ce que `loadVoiceStyle()` (engine.ts)
// utilise réellement pour lire l'OPFS d'abord : tester `loadVoiceStyle()`
// lui-même exigerait de charger onnxruntime-web via un import dynamique
// `browser.runtime.getURL(...)`, indisponible sous `node --test` — la seule
// branche qui compte (style présent → pas de réseau) vit entièrement dans
// cette fonction-ci.
import assert from "node:assert/strict"
import test, { beforeEach } from "node:test"
import { ONNX_FILES, SUPERTONIC_VOICES } from "./types.ts"
import { MODEL_HASHES, MODEL_SIZES } from "./model-integrity.ts"

/** Répertoire OPFS en mémoire — assez pour getFileHandle/createWritable/getFile. */
class FakeDir {
  files = new Map<string, ArrayBuffer>()

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("Not found", "NotFoundError")
      this.files.set(name, new Uint8Array([1, 2, 3]).buffer)
    }
    const files = this.files
    return {
      async getFile() {
        const buf = files.get(name)!
        return { size: buf.byteLength, arrayBuffer: async () => buf }
      },
      async createWritable() {
        let pending = new ArrayBuffer(0)
        return {
          async write(data: ArrayBuffer) {
            pending = data
          },
          async close() {
            files.set(name, pending)
          },
        }
      },
    }
  }
}

let dir: FakeDir

beforeEach(async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
  for (const name of Object.keys(MODEL_HASHES)) {
    (MODEL_HASHES as Record<string, string>)[name] = hash
    ;(MODEL_SIZES as Record<string, number>)[name] = bytes.byteLength
  }
  dir = new FakeDir()
  ;(globalThis as any).navigator.storage = {
    getDirectory: async () => ({
      getDirectoryHandle: async () => dir,
    }),
    persist: async () => true,
  }
})

const TOTAL_FILES = ONNX_FILES.length + SUPERTONIC_VOICES.length

function fakeResponse(bytes: Uint8Array) {
  let delivered = false
  return {
    ok: true,
    headers: { get: () => String(bytes.byteLength) },
    body: {
      getReader: () => ({
        async read() {
          if (delivered) return { done: true, value: undefined }
          delivered = true
          return { done: false, value: bytes }
        },
      }),
    },
  }
}

test("loadModelFiles() : deux appels concurrents ne fetchent chaque fichier qu'une fois", async () => {
  const { loadModelFiles } = await import("./model-cache.ts?concurrent")
  let fetchCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetchCalls++
    return fakeResponse(new Uint8Array([1, 2, 3])) as unknown as Response
  }) as typeof fetch
  try {
    const [a, b] = await Promise.all([loadModelFiles(), loadModelFiles()])
    assert.equal(fetchCalls, TOTAL_FILES)
    assert.equal(typeof a, "function")
    assert.equal(typeof b, "function")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("loadModelFiles(signal) : une annulation en cours de fichier rejette, et les fichiers déjà écrits restent", async () => {
  const { loadModelFiles } = await import("./model-cache.ts?abort")
  const controller = new AbortController()
  let fetchCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetchCalls++
    // Annule après le premier fichier, avant que le second ne parte —
    // fetch() rejette alors lui-même, comme le ferait une vraie annulation.
    if (fetchCalls === 2) {
      controller.abort()
      throw new DOMException("Aborted", "AbortError")
    }
    return fakeResponse(new Uint8Array([1, 2, 3])) as unknown as Response
  }) as typeof fetch
  try {
    await assert.rejects(loadModelFiles(undefined, controller.signal), /Aborted|AbortError/)
    assert.equal(dir.files.has(ONNX_FILES[0]!.name), true, "le premier fichier écrit doit rester")
    assert.equal(dir.files.has(ONNX_FILES[1]!.name), false, "le fichier interrompu ne doit pas être écrit")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("readCachedVoiceStyle() : renvoie les octets en cache sans indication d'un réseau à faire", async () => {
  const { readCachedVoiceStyle } = await import("./model-cache.ts?voice-cached")
  const bytes = new TextEncoder().encode('{"style_ttl":1}').buffer
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  ;(MODEL_HASHES as Record<string, string>)["voice-F1.json"] = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
  ;(MODEL_SIZES as Record<string, number>)["voice-F1.json"] = bytes.byteLength
  dir.files.set("voice-F1.json", bytes)
  const result = await readCachedVoiceStyle("F1")
  assert.ok(result)
  assert.deepEqual(new Uint8Array(result!), new Uint8Array(bytes))
})

test("readCachedVoiceStyle() : renvoie null quand le style n'est pas en cache", async () => {
  const { readCachedVoiceStyle } = await import("./model-cache.ts?voice-missing")
  const result = await readCachedVoiceStyle("M1")
  assert.equal(result, null)
})

test("isModelCached() : faux si un style de voix manque, même avec tous les fichiers ONNX présents", async () => {
  const { isModelCached } = await import("./model-cache.ts?manifest")
  for (const { name } of ONNX_FILES) dir.files.set(name, new Uint8Array([1, 2, 3]).buffer)
  for (const voice of SUPERTONIC_VOICES) dir.files.set(`voice-${voice}.json`, new Uint8Array([1, 2, 3]).buffer)
  assert.equal(await isModelCached(), true, "tout présent → vrai")

  dir.files.delete("voice-F1.json")
  assert.equal(await isModelCached(), false, "un style manquant → faux, malgré les ONNX complets")
})


test("corrupt cached voices are rejected", async () => {
  const { readCachedVoiceStyle } = await import("./model-cache.ts?corrupt")
  dir.files.set("voice-F1.json", new Uint8Array([3, 2, 1]).buffer)
  assert.equal(await readCachedVoiceStyle("F1"), null)
})

test("corrupt downloads are never written to cache", async () => {
  const { loadModelFiles } = await import("./model-cache.ts?bad-download")
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => fakeResponse(new Uint8Array([3, 2, 1])) as unknown as Response) as typeof fetch
  try {
    await assert.rejects(loadModelFiles(), /integrity check failed/)
    assert.equal(dir.files.size, 0)
  } finally { globalThis.fetch = originalFetch }
})

test("corrupt cache is replaced by verified downloads", async () => {
  const { loadModelFiles } = await import("./model-cache.ts?repair")
  for (const name of Object.keys(MODEL_HASHES)) dir.files.set(name, new Uint8Array([3, 2, 1]).buffer)
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return fakeResponse(new Uint8Array([1, 2, 3])) as unknown as Response
  }) as typeof fetch
  try {
    const read = await loadModelFiles()
    assert.equal(calls, TOTAL_FILES)
    assert.deepEqual(new Uint8Array(await read(ONNX_FILES[0].name)), new Uint8Array([1, 2, 3]))
    dir.files.set(ONNX_FILES[0].name, new Uint8Array([3, 2, 1]).buffer)
    await assert.rejects(read(ONNX_FILES[0].name), /integrity check failed/)
  } finally { globalThis.fetch = originalFetch }
})


test("voice fallback verifies bytes and uses the pinned revision", async () => {
  const { loadVoiceStyleBytes } = await import("./model-cache.ts?voice-fallback")
  const originalFetch = globalThis.fetch
  let corrupt = true
  globalThis.fetch = (async (url: string) => {
    assert.ok(!url.includes("/resolve/main/"))
    return { ok: true, arrayBuffer: async () => new Uint8Array(corrupt ? [3, 2, 1] : [1, 2, 3]).buffer } as Response
  }) as typeof fetch
  try {
    await assert.rejects(loadVoiceStyleBytes("F1"), /integrity check failed/)
    corrupt = false
    assert.deepEqual(new Uint8Array(await loadVoiceStyleBytes("F1")), new Uint8Array([1, 2, 3]))
  } finally { globalThis.fetch = originalFetch }
})
