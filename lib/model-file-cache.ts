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
): Promise<ArrayBuffer> {
  if (!response.body) throw new Error("Model file has no data")
  const bytes = new Uint8Array(new ArrayBuffer(file.size))
  const reader = response.body.getReader()
  let offset = 0
  let ended = false
  try {
    onProgress?.(0)
    for (;;) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) {
        ended = true
        break
      }
      if (offset + value.byteLength > bytes.byteLength) throw new Error("Model file exceeds its published size")
      bytes.set(value, offset)
      offset += value.byteLength
      onProgress?.(offset)
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  if (offset !== file.size || !await verified(bytes.buffer, file)) throw new Error("Model file integrity check failed")
  signal.throwIfAborted()
  return bytes.buffer
}

/** Cache complete, verified model files independently of other engines. */
export function createModelFileCache(cacheName: string, name: string) {
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
    const response = await fetch(file.url, { signal, credentials: "omit", referrerPolicy: "no-referrer" })
    if (!response.ok) throw new Error(`${name} model download failed (HTTP ${response.status})`)
    const bytes = await readVerified(response, file, signal, onProgress)
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
