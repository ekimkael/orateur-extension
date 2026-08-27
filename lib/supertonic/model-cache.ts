// lib/supertonic/model-cache.ts
//
// Copié de web/app/lib/supertonic/model-cache.ts, à plusieurs deltas près.
//
// Deltas (jalon 1b, page d'options) : `clearModelCache` et `isModelCached`
// sont exportées — web/app n'a pas besoin d'effacer son propre cache depuis
// l'extérieur — et `getModelCacheSize` est nouvelle, pour afficher le poids
// réel du cache dans les réglages plutôt que le seul booléen "téléchargé".
//
// Delta (jalon 1d, téléchargement explicite depuis les options) : cette
// fonction n'avait qu'un seul appelant (ensureEngine() dans tts-host.ts),
// donc jamais deux téléchargements en vol à la fois. Un bouton dans la page
// d'options change ça — voir la mémoïsation de `loadModelFiles()` plus bas —
// et exige aussi que `loadVoiceStyle()` (engine.ts) devienne vraie hors
// ligne : les 10 styles de voix rejoignent le manifeste téléchargé, sans quoi
// le modèle serait "prêt" en apparence tout en échouant au premier `speak()`
// loin du réseau.

// Extension explicite : ce fichier est aussi chargé par `node --test` (via
// tts-host.test.ts), dont le résolveur ESM ne devine pas l'extension.
import { ONNX_FILES, SUPERTONIC_VOICES, VOICE_STYLE_BASE, type SupertonicVoice } from "./types.ts"

const CACHE_DIR = "supertonic-v3"

/** Nom de fichier OPFS d'un style de voix — préfixé pour ne pas entrer en
 *  collision avec les noms plats de ONNX_FILES dans le même répertoire. */
function voiceStyleFileName(voice: SupertonicVoice): string {
  return `voice-${voice}.json`
}

/**
 * Mêmes octets que `loadVoiceStyle()` (engine.ts) télécharge aujourd'hui à
 * chaque lecture, sans jamais les garder : les mettre dans le même manifeste
 * que les fichiers ONNX rend "fonctionne hors ligne" vrai pour les 10 voix,
 * pas seulement pour le moteur.
 */
const VOICE_STYLE_FILES = SUPERTONIC_VOICES.map((voice) => ({
  name: voiceStyleFileName(voice),
  path: `${VOICE_STYLE_BASE}/${voice}.json`,
}))

const ALL_FILES: readonly { name: string; path: string }[] = [...ONNX_FILES, ...VOICE_STYLE_FILES]

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

/** Télécharge un fichier, avec une retente pour une coupure transitoire.
 *  Pas de retente sur une annulation : c'est un choix de l'appelant, pas un
 *  échec réseau. */
async function fetchFileWithRetry(
  file: { name: string; path: string },
  fileIndex: number,
  totalFiles: number,
  signal: AbortSignal | undefined,
  broadcast: (p: DownloadProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchFile(file, fileIndex, totalFiles, signal, broadcast)
    } catch (e) {
      if (attempt > 0 || signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e
      // Une seule retente automatique, sur ce fichier seulement — jamais sur
      // les 398 Mo entiers, qui pourraient entamer un forfait mobile que
      // personne n'a réautorisé.
    }
  }
}

async function fetchFile(
  file: { name: string; path: string },
  fileIndex: number,
  totalFiles: number,
  signal: AbortSignal | undefined,
  broadcast: (p: DownloadProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(file.path, { signal })
  if (!response.ok) {
    throw new Error(`Failed to download ${file.name}: HTTP ${response.status}`)
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
      broadcast({
        fileName: file.name, fileIndex, totalFiles,
        bytesLoaded, bytesTotal: contentLength, phase: "downloading",
      })
    }
  }

  // Mise à jour finale garantie
  broadcast({
    fileName: file.name, fileIndex, totalFiles,
    bytesLoaded, bytesTotal: contentLength, phase: "downloading",
  })

  const merged = new Uint8Array(bytesLoaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/**
 * Un seul téléchargement en vol par processus : un second appel s'attache
 * aux mêmes progrès au lieu de refetcher 398 Mo en double, et se répercute
 * le même résultat (ou la même erreur) à son retour.
 *
 * Suffit ici — seul l'hôte (document offscreen / page de fond, voir
 * tts-messages.ts) appelle cette fonction, jamais la page d'options
 * directement — donc cette mémoïsation en mémoire du process couvre déjà
 * "lecture en cours + téléchargement explicite" et "deux onglets d'options",
 * tous deux relayés par le même hôte.
 *
 * ponytail : pas de Web Locks API inter-contexte, inutile tant que ce
 * design à hôte unique tient — à revoir si `loadModelFiles()` gagne un
 * second appelant direct hors de l'hôte.
 */
let inFlight: {
  promise: Promise<(name: string) => Promise<ArrayBuffer>>
  listeners: Set<(p: DownloadProgress) => void>
} | null = null

export function loadModelFiles(
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<(name: string) => Promise<ArrayBuffer>> {
  if (inFlight) {
    const { promise, listeners } = inFlight
    if (onProgress) listeners.add(onProgress)
    return onProgress ? promise.finally(() => listeners.delete(onProgress)) : promise
  }

  const listeners = new Set<(p: DownloadProgress) => void>(onProgress ? [onProgress] : [])
  const broadcast = (p: DownloadProgress) => {
    for (const l of listeners) l(p)
  }

  const promise = (async (): Promise<(name: string) => Promise<ArrayBuffer>> => {
    // OPFS est bloqué en navigation privée (Firefox SecurityError) — on continue
    // sans cache persistant et on garde les fichiers en mémoire dans ce cas.
    let dir: FileSystemDirectoryHandle | null = null
    try {
      dir = await getCacheRoot()
      // Best-effort : ne bloque jamais le téléchargement sur son résultat —
      // juste une meilleure chance de survivre à une purge sous pression disque.
      void navigator.storage.persist?.().catch(() => {})
    } catch {
      // pas de cache persistant disponible
    }

    const memFallback = new Map<string, ArrayBuffer>()

    for (let i = 0; i < ALL_FILES.length; i++) {
      const file = ALL_FILES[i]!
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

      broadcast({
        fileName: file.name, fileIndex: i, totalFiles: ALL_FILES.length,
        bytesLoaded: 0, bytesTotal: 0, phase: "checking",
      })

      if (dir && await isCached(dir, file.name)) {
        broadcast({
          fileName: file.name, fileIndex: i, totalFiles: ALL_FILES.length,
          bytesLoaded: 1, bytesTotal: 1, phase: "cached",
        })
        continue
      }

      const merged = await fetchFileWithRetry(file, i, ALL_FILES.length, signal, broadcast)

      if (dir) {
        try {
          await writeCache(dir, file.name, merged.buffer)
        } catch {
          // createWritable() peut échouer en navigation privée même si le répertoire
          // existe — on désactive le cache et on garde ce fichier en mémoire.
          dir = null
          memFallback.set(file.name, merged.buffer)
        }
      } else {
        memFallback.set(file.name, merged.buffer)
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
  })()

  inFlight = { promise, listeners }
  // Détaché de la promesse renvoyée à l'appelant : un échec ne doit remettre
  // `inFlight` à zéro (pour permettre une retente complète) qu'une fois que
  // tout le monde a fini de la lire, jamais avant.
  void promise.finally(() => { inFlight = null }).catch(() => {})
  return promise
}

export async function clearModelCache(): Promise<void> {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(CACHE_DIR, { recursive: true })
}

export async function isModelCached(): Promise<boolean> {
  try {
    const dir = await getCacheRoot()
    const results = await Promise.all(ALL_FILES.map(({ name }) => isCached(dir, name)))
    return results.every(Boolean)
  } catch {
    return false
  }
}

/** Octets réellement occupés par le cache, ou `null` s'il n'est pas complet. */
export async function getModelCacheSize(): Promise<number | null> {
  try {
    const dir = await getCacheRoot()
    let total = 0
    for (const { name } of ALL_FILES) {
      const handle = await dir.getFileHandle(name)
      const file = await handle.getFile()
      total += file.size
    }
    return total
  } catch {
    // Un seul fichier manquant ou une OPFS indisponible valent "pas de cache" :
    // la page d'options n'a rien de plus précis à afficher dans ce cas que
    // isModelCached() ne dit déjà.
    return null
  }
}

/**
 * Sonde silencieuse pour la page d'options : proposer un bouton de
 * téléchargement qui échouera à coup sûr (navigation privée Firefox, OPFS
 * bloqué) est pire que ne pas le proposer — voir isCached()/getCacheRoot()
 * ci-dessus pour la même détection côté téléchargement lui-même.
 */
export async function isCacheWritable(): Promise<boolean> {
  try {
    await getCacheRoot()
    return true
  } catch {
    return false
  }
}

/**
 * Lit un style de voix déjà en cache, ou `null` s'il n'y est pas — c'est à
 * l'appelant (engine.ts) de retomber sur le réseau dans ce cas : un modèle
 * mis en cache avant ce delta n'a aucun style sur disque.
 */
export async function readCachedVoiceStyle(voice: SupertonicVoice): Promise<ArrayBuffer | null> {
  try {
    const dir = await getCacheRoot()
    return await readCached(dir, voiceStyleFileName(voice))
  } catch {
    return null
  }
}
