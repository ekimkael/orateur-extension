// lib/supertonic/model-cache.ts
//
// Copié de web/app/lib/supertonic/model-cache.ts sans modification.

import { ONNX_FILES } from "./types"

const CACHE_DIR = "supertonic-v3"

async function getCacheRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(CACHE_DIR, { create: true })
}

async function isCached(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

async function readCached(dir: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  const handle = await dir.getFileHandle(name)
  const file = await handle.getFile()
  return file.arrayBuffer()
}

async function writeCache(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: ArrayBuffer,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

export interface DownloadProgress {
  fileName: string
  fileIndex: number
  totalFiles: number
  bytesLoaded: number
  bytesTotal: number
  phase: "checking" | "downloading" | "cached"
}

export async function loadModelFiles(
  onProgress?: (p: DownloadProgress) => void,
): Promise<(name: string) => Promise<ArrayBuffer>> {
  // OPFS est bloqué en navigation privée (Firefox SecurityError) — on continue
  // sans cache persistant et on garde les fichiers en mémoire dans ce cas.
  let dir: FileSystemDirectoryHandle | null = null
  try {
    dir = await getCacheRoot()
  } catch {
    // pas de cache persistant disponible
  }

  const memFallback = new Map<string, ArrayBuffer>()

  for (let i = 0; i < ONNX_FILES.length; i++) {
    const { name, path } = ONNX_FILES[i]!

    onProgress?.({
      fileName: name, fileIndex: i, totalFiles: ONNX_FILES.length,
      bytesLoaded: 0, bytesTotal: 0, phase: "checking",
    })

    if (dir && await isCached(dir, name)) {
      onProgress?.({
        fileName: name, fileIndex: i, totalFiles: ONNX_FILES.length,
        bytesLoaded: 1, bytesTotal: 1, phase: "cached",
      })
      continue
    }

    const response = await fetch(path)
    if (!response.ok) {
      throw new Error(`Failed to download ${name}: HTTP ${response.status}`)
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0)
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let bytesLoaded = 0
    let lastProgressTime = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      bytesLoaded += value.byteLength
      // Throttle à ~60fps : évite N×1600 set() Zustand pour un fichier de 100Mo
      const now = performance.now()
      if (now - lastProgressTime > 16) {
        lastProgressTime = now
        onProgress?.({
          fileName: name, fileIndex: i, totalFiles: ONNX_FILES.length,
          bytesLoaded, bytesTotal: contentLength, phase: "downloading",
        })
      }
    }

    // Mise à jour finale garantie
    onProgress?.({
      fileName: name, fileIndex: i, totalFiles: ONNX_FILES.length,
      bytesLoaded, bytesTotal: contentLength, phase: "downloading",
    })

    const merged = new Uint8Array(bytesLoaded)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    if (dir) {
      try {
        await writeCache(dir, name, merged.buffer)
      } catch {
        // createWritable() peut échouer en navigation privée même si le répertoire
        // existe — on désactive le cache et on garde ce fichier en mémoire.
        dir = null
        memFallback.set(name, merged.buffer)
      }
    } else {
      memFallback.set(name, merged.buffer)
    }
  }

  // Lecteur : mémoire d'abord (fallback navigation privée / OPFS indisponible),
  // puis OPFS paresseux quand le cache est actif.
  return async (name: string) => {
    const mem = memFallback.get(name)
    if (mem) return mem
    if (!dir) throw new Error(`Model file not found: ${name}`)
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    return file.arrayBuffer()
  }
}

async function clearModelCache(): Promise<void> {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(CACHE_DIR, { recursive: true })
}

async function isModelCached(): Promise<boolean> {
  try {
    const dir = await getCacheRoot()
    const results = await Promise.all(ONNX_FILES.map(({ name }) => isCached(dir, name)))
    return results.every(Boolean)
  } catch {
    return false
  }
}
