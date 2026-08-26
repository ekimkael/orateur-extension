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

/** Répertoire OPFS en mémoire — assez pour getFileHandle/createWritable/getFile. */
class FakeDir {
  files = new Map<string, ArrayBuffer>()

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("Not found", "NotFoundError")
      this.files.set(name, new ArrayBuffer(0))
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

beforeEach(() => {
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
  for (const { name } of ONNX_FILES) dir.files.set(name, new ArrayBuffer(0))
  for (const voice of SUPERTONIC_VOICES) dir.files.set(`voice-${voice}.json`, new ArrayBuffer(0))
  assert.equal(await isModelCached(), true, "tout présent → vrai")

  dir.files.delete("voice-F1.json")
  assert.equal(await isModelCached(), false, "un style manquant → faux, malgré les ONNX complets")
})
