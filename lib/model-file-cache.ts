/** Immutable metadata for a downloadable model file. */
export interface ModelFile {
  url: string
  size: number
  sha256: string
}

async function verified(bytes: ArrayBuffer, file: ModelFile) {
  if (bytes.byteLength !== file.size) return false
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") === file.sha256
}

async function readVerified(
  response: Response,
  file: ModelFile,
  signal: AbortSignal,
  onProgress?: (loaded: number) => void,
  resume?: (offset: number) => Promise<Response>,
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(file.size))
  let offset = 0

  async function read(response: Response) {
    if (!response.body) throw new Error("Model file has no data")
    const reader = response.body.getReader()
    let ended = false
    try {
      for (;;) {
        const chunk = await reader.read().catch((error: unknown) => ({ error }))
        signal.throwIfAborted()
        if ("error" in chunk) return chunk
        if (chunk.done) {
          ended = true
          return
        }
        if (offset + chunk.value.byteLength > bytes.byteLength) throw new Error("Model file exceeds its published size")
        bytes.set(chunk.value, offset)
        offset += chunk.value.byteLength
        onProgress?.(offset)
      }
    } finally {
      if (!ended) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  onProgress?.(0)
  let failure = await read(response)
  // Keep partial bytes in memory. Only the complete pinned digest can reach the cache or runtime.
  for (let attempt = 0; resume && offset > 0 && offset < file.size && attempt < 2; attempt++) {
    failure = await read(await resume(offset))
  }
  if (failure) throw failure.error
  if (offset !== file.size || !await verified(bytes.buffer, file)) throw new Error("Model file integrity check failed")
  signal.throwIfAborted()
  return bytes.buffer
}

/** Cache complete, verified model files. Opt in to resuming only for range-capable sources. */
export function createModelFileCache(cacheName: string, name: string, { resumeDownloads = false } = {}) {
  async function openCache() {
    try {
      return await globalThis.caches?.open(cacheName)
    } catch {
      return undefined
    }
  }

  async function has(files: readonly ModelFile[]): Promise<boolean> {
    try {
      const cache = await openCache()
      if (!cache) return false
      const present = await Promise.all(files.map(async (file) =>
        (await cache.match(file.url))?.headers.get("Content-Length") === String(file.size),
      ))
      return present.every(Boolean)
    } catch {
      return false
    }
  }

  async function size(): Promise<number | null> {
    try {
      const cache = await openCache()
      if (!cache) return null
      let bytes = 0
      for (const request of await cache.keys()) {
        const length = Number((await cache.match(request))?.headers.get("Content-Length"))
        if (Number.isSafeInteger(length) && length > 0) bytes += length
      }
      return bytes
    } catch {
      return null
    }
  }

  async function load(
    file: ModelFile,
    signal: AbortSignal,
    onProgress?: (loaded: number) => void,
    cacheOnly = false,
  ): Promise<ArrayBuffer> {
    const cache = await openCache()
    signal.throwIfAborted()
    try {
      const cached = await cache?.match(file.url)
      if (cached) {
        if (cached.headers.get("Content-Length") === String(file.size)) {
          const bytes = await readVerified(cached, file, signal).catch(() => null)
          if (bytes) return bytes
        }
        signal.throwIfAborted()
        await cache?.delete(file.url)
      }
    } catch {
      // A cache failure is recoverable while the model is reachable.
    }
    signal.throwIfAborted()
    if (cacheOnly) throw new Error(`Verified ${name} model is unavailable offline`)
    const request: RequestInit = { signal, credentials: "omit", referrerPolicy: "no-referrer" }
    const response = await fetch(file.url, request)
    if (!response.ok) throw new Error(`${name} model download failed (HTTP ${response.status})`)
    const resume = resumeDownloads ? async (offset: number) => {
      const partial = await fetch(file.url, { ...request, headers: { Range: `bytes=${offset}-` } })
      if (partial.status !== 206 || partial.headers.get("Content-Range") !== `bytes ${offset}-${file.size - 1}/${file.size}`) {
        await partial.body?.cancel().catch(() => {})
        throw new Error(`Invalid range response for ${name} model (HTTP ${partial.status})`)
      }
      return partial
    } : undefined
    const bytes = await readVerified(response, file, signal, onProgress, resume)
    try {
      await cache?.put(file.url, new Response(bytes, { headers: { "Content-Length": String(file.size) } }))
    } catch {
      // Cache quota must not prevent an otherwise valid reading.
    }
    signal.throwIfAborted()
    return bytes
  }

  return {
    has,
    size,
    load,
    async clear() {
      await caches.delete(cacheName)
    },
  }
}
