// lib/supertonic/engine.ts
//
// Copié de web/app/lib/supertonic/engine.ts avec deux deltas, tous deux dans
// `loadOrt` et `loadTextToSpeechEngine` :
//
// 1. `new Function("url", "return import(url)")` — le contournement anti-Vite
//    du web app — est refusé ici : la CSP MV3 des pages d'extension interdit
//    `'unsafe-eval'` (Chrome rejette le manifeste qui l'ajoute), et
//    `'wasm-unsafe-eval'` ne le couvre pas. L'import dynamique direct suffit,
//    lui, et fonctionne (vérifié par le spike de phase 0).
// 2. `ORT.env.wasm.wasmPaths` pointe sur `browser.runtime.getURL(...)` plutôt
//    que sur `"/ort/"` en dur : en `wxt dev`, la page est servie par le
//    serveur Vite, où une URL racine-relative est ambiguë.
//
// AVAILABLE_LANGS/SupportedLang ont été sortis dans `../supertonic-lang.ts`,
// seule partie de ce fichier qui vaille la peine d'être testée sous
// `node --test` plutôt qu'à l'oreille.
import type * as ort from "onnxruntime-web"
// Extensions explicites : ce fichier est aussi chargé directement par
// `node --test` (via engine.test.ts), dont le résolveur ESM ne devine pas
// l'extension comme le fait Vite. Même convention que lib/pronunciation/*.
import { AVAILABLE_LANGS, type SupportedLang } from "../supertonic-lang.ts"
import type { SupertonicVoice } from "./types.ts"
import { VOICE_STYLE_BASE } from "./types.ts"

export type { SupportedLang }

let ORT: typeof ort
async function loadOrt(): Promise<typeof ort> {
  if (!ORT) {
    const url = browser.runtime.getURL("/ort/ort.bundle.min.mjs")
    ORT = (await import(/* @vite-ignore */ url)) as typeof ort
  }
  return ORT
}

// Spoken forms of digits 0–9 for every language supported by the model.
// Used to expand zero-padded numbers (e.g. "01" → "zéro un") before
// the text reaches the ONNX character-level encoder.
const DIGIT_WORDS: Partial<Record<string, string[]>> = {
  en: ["zero","one","two","three","four","five","six","seven","eight","nine"],
  fr: ["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf"],
  de: ["null","eins","zwei","drei","vier","fünf","sechs","sieben","acht","neun"],
  es: ["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve"],
  it: ["zero","uno","due","tre","quattro","cinque","sei","sette","otto","nove"],
  pt: ["zero","um","dois","três","quatro","cinco","seis","sete","oito","nove"],
  nl: ["nul","één","twee","drie","vier","vijf","zes","zeven","acht","negen"],
  ru: ["ноль","один","два","три","четыре","пять","шесть","семь","восемь","девять"],
  uk: ["нуль","один","два","три","чотири","п'ять","шість","сім","вісім","дев'ять"],
  pl: ["zero","jeden","dwa","trzy","cztery","pięć","sześć","siedem","osiem","dziewięć"],
  cs: ["nula","jedna","dva","tři","čtyři","pět","šest","sedm","osm","devět"],
  sk: ["nula","jedna","dva","tri","štyri","päť","šesť","sedem","osem","deväť"],
  ro: ["zero","unu","doi","trei","patru","cinci","șase","șapte","opt","nouă"],
  hu: ["nulla","egy","kettő","három","négy","öt","hat","hét","nyolc","kilenc"],
  hr: ["nula","jedan","dva","tri","četiri","pet","šest","sedam","osam","devet"],
  sl: ["nič","ena","dva","tri","štiri","pet","šest","sedem","osem","devet"],
  bg: ["нула","едно","две","три","четири","пет","шест","седем","осем","девет"],
  el: ["μηδέν","ένα","δύο","τρία","τέσσερα","πέντε","έξι","επτά","οκτώ","εννέα"],
  lt: ["nulis","vienas","du","trys","keturi","penki","šeši","septyni","aštuoni","devyni"],
  lv: ["nulle","viens","divi","trīs","četri","pieci","seši","septiņi","astoņi","deviņi"],
  et: ["null","üks","kaks","kolm","neli","viis","kuus","seitse","kaheksa","üheksa"],
  sv: ["noll","ett","två","tre","fyra","fem","sex","sju","åtta","nio"],
  da: ["nul","et","to","tre","fire","fem","seks","syv","otte","ni"],
  fi: ["nolla","yksi","kaksi","kolme","neljä","viisi","kuusi","seitsemän","kahdeksan","yhdeksän"],
  tr: ["sıfır","bir","iki","üç","dört","beş","altı","yedi","sekiz","dokuz"],
  id: ["nol","satu","dua","tiga","empat","lima","enam","tujuh","delapan","sembilan"],
  vi: ["không","một","hai","ba","bốn","năm","sáu","bảy","tám","chín"],
  ko: ["영","일","이","삼","사","오","육","칠","팔","구"],
  ja: ["ゼロ","一","二","三","四","五","六","七","八","九"],
  ar: ["صفر","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة"],
  hi: ["शून्य","एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ"],
}

export class UnicodeProcessor {
  private indexer: number[]

  constructor(indexer: number[]) {
    this.indexer = indexer
  }

  private expandLeadingZeroNumbers(text: string, lang: string): string {
    const words = DIGIT_WORDS[lang]
    return text.replace(/\b0\d+\b/g, (match) => {
      if (!words) return match.split("").join(" ")
      return match.split("").map((d) => words[parseInt(d, 10)] ?? d).join(" ")
    })
  }

  call(textList: string[], langList: string[]) {
    // `noUncheckedIndexedAccess` (activé par WXT, pas par le web app dont ce
    // fichier est porté) ne peut pas voir que `textList`/`langList` avancent
    // toujours de pair — c'est un contrat de l'appelant, pas un risque réel.
    const processedTexts = textList.map((text, i) =>
      this.preprocessText(text, langList[i]!)
    )
    const textIdsLengths = processedTexts.map((t) => t.length)
    const maxLen = Math.max(...textIdsLengths)
    const textIds = processedTexts.map((text) => {
      const row = new Array(maxLen).fill(0)
      for (let j = 0; j < text.length; j++) {
        const cp = text.codePointAt(j) ?? 0
        row[j] = cp < this.indexer.length ? this.indexer[cp] : -1
      }
      return row
    })
    const textMask = this.getTextMask(textIdsLengths)
    return { textIds, textMask }
  }

  preprocessText(text: string, lang: string): string {
    text = text.normalize("NFKD")
    const emojiPattern =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu
    text = text.replace(emojiPattern, "")

    const replacements: Record<string, string> = {
      "–": "-", "‑": "-", "—": "-", "_": " ",
      "“": '"', "”": '"', "‘": "'", "’": "'",
      "´": "'", "`": "'", "[": " ", "]": " ", "|": " ",
      "/": " ", "#": " ", "→": " ", "←": " ",
    }
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replaceAll(k, v)
    }
    text = text.replace(/[♥☆♡©\\]/g, "")

    const exprReplacements: Record<string, string> = {
      "@": " at ", "e.g.,": "for example, ", "i.e.,": "that is, ",
    }
    for (const [k, v] of Object.entries(exprReplacements)) {
      text = text.replaceAll(k, v)
    }

    text = text.replace(/ ,/g, ",").replace(/ \./g, ".").replace(/ !/g, "!")
      .replace(/ \?/g, "?").replace(/ ;/g, ";").replace(/ :/g, ":")
      .replace(/ '/g, "'")

    while (text.includes('""')) text = text.replace('""', '"')
    while (text.includes("''")) text = text.replace("''", "'")
    while (text.includes("``")) text = text.replace("``", "`")

    text = text.replace(/\s+/g, " ").trim()

    text = this.expandLeadingZeroNumbers(text, lang)

    if (!/[.!?;:,'")\]}…。、，；」』】〉》›»]$/.test(text)) text += "."

    if (!AVAILABLE_LANGS.includes(lang as SupportedLang)) {
      throw new Error(
        `Invalid language: ${lang}. Available: ${AVAILABLE_LANGS.join(", ")}`
      )
    }
    return `<${lang}>${text}</${lang}>`
  }

  private getTextMask(lengths: number[]) {
    const maxLen = Math.max(...lengths)
    return this.lengthToMask(lengths, maxLen)
  }

  lengthToMask(lengths: number[], maxLen: number | null = null) {
    const actual = maxLen ?? Math.max(...lengths)
    return lengths.map((len) => {
      const row = new Array(actual).fill(0.0)
      for (let j = 0; j < Math.min(len, actual); j++) row[j] = 1.0
      return [row]
    })
  }
}

export class Style {
  // Propriétés de constructeur réécrites en affectations explicites : c'est
  // une syntaxe TS non « erasable », que le mode strip-only de Node (utilisé
  // par `node --test` pour charger du .ts sans transpilation complète) ne
  // sait pas parser. Vite, lui, les transforme sans problème — c'est le seul
  // delta qui existe uniquement pour la testabilité, comportement identique.
  ttl: ort.Tensor
  dp: ort.Tensor

  constructor(ttl: ort.Tensor, dp: ort.Tensor) {
    this.ttl = ttl
    this.dp = dp
  }
}

interface TtsCfgs {
  ae: { sample_rate: number; base_chunk_size: number }
  ttl: { chunk_compress_factor: number; latent_dim: number }
}

export class TextToSpeech {
  sampleRate: number
  // Mêmes propriétés que la construction courte les aurait déclarées : voir
  // le commentaire sur `Style` pour la raison de l'écriture explicite.
  private cfgs: TtsCfgs
  private textProcessor: UnicodeProcessor
  private dpOrt: ort.InferenceSession
  private textEncOrt: ort.InferenceSession
  private vectorEstOrt: ort.InferenceSession
  private vocoderOrt: ort.InferenceSession

  constructor(
    cfgs: TtsCfgs,
    textProcessor: UnicodeProcessor,
    dpOrt: ort.InferenceSession,
    textEncOrt: ort.InferenceSession,
    vectorEstOrt: ort.InferenceSession,
    vocoderOrt: ort.InferenceSession,
  ) {
    this.cfgs = cfgs
    this.textProcessor = textProcessor
    this.dpOrt = dpOrt
    this.textEncOrt = textEncOrt
    this.vectorEstOrt = vectorEstOrt
    this.vocoderOrt = vocoderOrt
    this.sampleRate = cfgs.ae.sample_rate
  }

  private async _infer(
    textList: string[],
    langList: string[],
    style: Style,
    totalStep: number,
    speed: number,
    signal?: AbortSignal,
  ) {
    const bsz = textList.length

    // Proxy mode transfers (zero-copy) every tensor buffer passed to session.run()
    // to the worker, detaching it on the main thread. Raw TypedArrays are kept here;
    // a fresh ort.Tensor is constructed immediately before each run() call.
    const styleDpRaw = (style.dp.data as Float32Array).slice()
    const styleDpDims = Array.from(style.dp.dims)
    const styleTtlRaw = (style.ttl.data as Float32Array).slice()
    const styleTtlDims = Array.from(style.ttl.dims)

    const { textIds, textMask } = this.textProcessor.call(textList, langList)

    const textIdsRaw = new BigInt64Array(textIds.flat().map((x) => BigInt(x)))
    const textIdsDims = [bsz, textIds[0]!.length]
    const textMaskRaw = new Float32Array(textMask.flat(2))
    const textMaskDims = [bsz, 1, textMask[0]![0]!.length]

    signal?.throwIfAborted()

    const dpOutputs = await this.dpOrt.run({
      text_ids: new ORT.Tensor("int64", textIdsRaw.slice(), textIdsDims),
      style_dp: new ORT.Tensor(style.dp.type, styleDpRaw.slice(), styleDpDims),
      text_mask: new ORT.Tensor("float32", textMaskRaw.slice(), textMaskDims),
    })
    const duration = Array.from(dpOutputs.duration!.data as Float32Array)
    for (let i = 0; i < duration.length; i++) duration[i] = duration[i]! / speed

    signal?.throwIfAborted()

    const textEncOutputs = await this.textEncOrt.run({
      text_ids: new ORT.Tensor("int64", textIdsRaw.slice(), textIdsDims),
      style_ttl: new ORT.Tensor(style.ttl.type, styleTtlRaw.slice(), styleTtlDims),
      text_mask: new ORT.Tensor("float32", textMaskRaw.slice(), textMaskDims),
    })
    // textEmb output buffer is also transferred on the first vectorEst run(),
    // so keep the raw data and rebuild the tensor each iteration.
    const textEmbRaw = (textEncOutputs.text_emb!.data as Float32Array).slice()
    const textEmbDims = Array.from(textEncOutputs.text_emb!.dims)

    let { xt, latentMask } = this._sampleNoisyLatent(duration)

    const latentMaskRaw = new Float32Array(latentMask.flat(2))
    const latentMaskDims = [bsz, 1, latentMask[0]![0]!.length]

    for (let step = 0; step < totalStep; step++) {
      signal?.throwIfAborted()

      const xtShape = [bsz, xt[0]!.length, xt[0]![0]!.length]
      const vectorEstOutputs = await this.vectorEstOrt.run({
        noisy_latent: new ORT.Tensor("float32", new Float32Array(xt.flat(2)), xtShape),
        text_emb: new ORT.Tensor("float32", textEmbRaw.slice(), textEmbDims),
        style_ttl: new ORT.Tensor(style.ttl.type, styleTtlRaw.slice(), styleTtlDims),
        latent_mask: new ORT.Tensor("float32", latentMaskRaw.slice(), latentMaskDims),
        text_mask: new ORT.Tensor("float32", textMaskRaw.slice(), textMaskDims),
        current_step: new ORT.Tensor("float32", new Float32Array(bsz).fill(step), [bsz]),
        total_step: new ORT.Tensor("float32", new Float32Array(bsz).fill(totalStep), [bsz]),
      })

      const denoised = Array.from(vectorEstOutputs.denoised_latent!.data as Float32Array)
      const latentDim = xt[0]!.length
      const latentLen = xt[0]![0]!.length
      xt = []
      let idx = 0
      for (let b = 0; b < bsz; b++) {
        const batch: number[][] = []
        for (let d = 0; d < latentDim; d++) {
          const row: number[] = []
          for (let t = 0; t < latentLen; t++) row.push(denoised[idx++]!)
          batch.push(row)
        }
        xt.push(batch)
      }
    }

    signal?.throwIfAborted()

    const finalXtTensor = new ORT.Tensor(
      "float32", new Float32Array(xt.flat(2)), [bsz, xt[0]!.length, xt[0]![0]!.length]
    )
    const vocoderOutputs = await this.vocoderOrt.run({ latent: finalXtTensor })
    const wav = vocoderOutputs.wav_tts!.data as Float32Array
    return { wav, duration }
  }

  async synthesize(
    text: string,
    lang: string,
    style: Style,
    totalStep = 8,
    speed = 1.0,
    signal?: AbortSignal,
  ): Promise<Float32Array<ArrayBufferLike>> {
    const maxLen = lang === "ko" || lang === "ja" ? 120 : 300
    const textList = chunkText(text, maxLen)
    const langList = new Array(textList.length).fill(lang)
    const SILENCE_DURATION = 0.3

    let wavCat: Float32Array<ArrayBufferLike> = new Float32Array(0)
    for (let i = 0; i < textList.length; i++) {
      signal?.throwIfAborted()
      const { wav } = await this._infer([textList[i]!], [langList[i]!], style, totalStep, speed, signal)
      if (wavCat.length === 0) {
        wavCat = wav
      } else {
        const silenceLen = Math.floor(SILENCE_DURATION * this.sampleRate)
        const next = new Float32Array(wavCat.length + silenceLen + wav.length)
        next.set(wavCat, 0)
        next.set(wav, wavCat.length + silenceLen)
        wavCat = next
      }
    }
    return wavCat
  }

  private _sampleNoisyLatent(duration: number[]) {
    const bsz = duration.length
    const { base_chunk_size } = this.cfgs.ae
    const { chunk_compress_factor, latent_dim } = this.cfgs.ttl
    const chunkSize = base_chunk_size * chunk_compress_factor
    const latentDimVal = latent_dim * chunk_compress_factor
    const maxDur = Math.max(...duration)
    const wavLenMax = Math.floor(maxDur * this.sampleRate)
    const wavLengths = duration.map((d) => Math.floor(d * this.sampleRate))
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize)

    const xt: number[][][] = []
    for (let b = 0; b < bsz; b++) {
      const batch: number[][] = []
      for (let d = 0; d < latentDimVal; d++) {
        const row: number[] = []
        for (let t = 0; t < latentLen; t++) {
          const u1 = Math.max(0.0001, Math.random())
          const u2 = Math.random()
          row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2))
        }
        batch.push(row)
      }
      xt.push(batch)
    }

    const latentLengths = wavLengths.map((len) =>
      Math.floor((len + chunkSize - 1) / chunkSize)
    )
    const latentMask = this._lengthToMask(latentLengths, latentLen)

    for (let b = 0; b < bsz; b++)
      for (let d = 0; d < latentDimVal; d++)
        for (let t = 0; t < latentLen; t++)
          xt[b]![d]![t] = xt[b]![d]![t]! * latentMask[b]![0]![t]!

    return { xt, latentMask }
  }

  private _lengthToMask(lengths: number[], maxLen: number) {
    return lengths.map((len) => {
      const row = new Array(maxLen).fill(0.0)
      for (let j = 0; j < Math.min(len, maxLen); j++) row[j] = 1.0
      return [row]
    })
  }
}

export async function loadVoiceStyle(voice: SupertonicVoice): Promise<Style> {
  const ORT = await loadOrt()
  const url = `${VOICE_STYLE_BASE}/${voice}.json`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch voice style ${voice}: ${response.status}`)
  const data = await response.json()

  const ttlData = data.style_ttl.data.flat(Infinity) as number[]
  const dpData = data.style_dp.data.flat(Infinity) as number[]
  const ttlTensor = new ORT.Tensor("float32", new Float32Array(ttlData), data.style_ttl.dims)
  const dpTensor = new ORT.Tensor("float32", new Float32Array(dpData), data.style_dp.dims)
  return new Style(ttlTensor, dpTensor)
}

export interface LoadProgress {
  name: string
  index: number
  total: number
}

export async function loadTextToSpeechEngine(
  getFile: (name: string) => Promise<ArrayBuffer>,
  onProgress?: (p: LoadProgress) => void,
): Promise<TextToSpeech> {
  await loadOrt()

  // Serve ORT's runtime same-origin from `/ort/` (files copied there by the
  // `copyOrtAssets` Vite plugin): the `.wasm` binary, the pthread worker `.mjs`,
  // and `ort.bundle.min.mjs` itself. Same-origin is what lets Chromium/Edge
  // spawn the WASM thread pool under COEP `credentialless`.
  //
  // Dérivé d'un fichier connu plutôt que de forcer `getURL("/ort/")` : WXT type
  // `getURL` sur les fichiers réellement présents dans public/, et un dossier
  // n'en est pas un.
  ORT.env.wasm.wasmPaths = browser.runtime
    .getURL("/ort/ort.bundle.min.mjs")
    .replace(/[^/]+$/, "")

  // Cross-origin isolation unlocks multi-threaded WebAssembly: ORT spawns
  // emscripten pthread workers from a real same-origin URL (import.meta.url).
  //
  // Chrome MV3 l'obtient par les clés COOP/COEP du manifeste (wxt.config.ts).
  // Firefox ne l'obtiendra pas : ces clés sont Chromium-only et ses pages
  // d'extension ne sont pas isolées (bug Mozilla 1673477, toujours ouvert).
  // D'où UN seul thread là-bas — c'est WebGPU, plus bas, qui porte ce cas.
  if (self.crossOriginIsolated) {
    const cores = navigator.hardwareConcurrency || 4
    ORT.env.wasm.numThreads = Math.max(2, Math.min(4, Math.floor(cores / 2)))
  } else {
    ORT.env.wasm.numThreads = 1
  }

  // Run inference in a dedicated proxy worker so session.run() never executes on
  // the main thread (without this, ORT enrols the calling thread — the UI thread
  // — into the WASM pool, freezing it for seconds during synthesis). The proxy
  // worker only loads under COI because ORT is a standalone same-origin module
  // (see loadOrt): its import.meta.url resolves to /ort/ort.bundle.min.mjs, a
  // valid worker entry, instead of a tree-shaken vendor chunk.
  ORT.env.wasm.proxy = true

  const cfgBuffer = await getFile("tts.json")
  const cfgs: TtsCfgs = JSON.parse(new TextDecoder().decode(cfgBuffer))

  const indexerBuffer = await getFile("unicode_indexer.json")
  const indexer: number[] = JSON.parse(new TextDecoder().decode(indexerBuffer))
  const textProcessor = new UnicodeProcessor(indexer)

  const onnxFiles = [
    { name: "duration_predictor.onnx", label: "Duration Predictor" },
    { name: "text_encoder.onnx", label: "Text Encoder" },
    { name: "vector_estimator.onnx", label: "Vector Estimator" },
    { name: "vocoder.onnx", label: "Vocoder" },
  ]

  /**
   * WebGPU d'abord, WASM en repli.
   *
   * Le repli interne d'ORT ne suffit pas : `webgpu` et `wasm` résolvent le même
   * backend, l'ordre du tableau ne décide donc pas seul de ce qui tourne. La
   * PREMIÈRE session sert de sonde — `create()` lève si `navigator.gpu` manque
   * (Mac Intel, Linux) ou si l'adaptateur est blocklisté (vieux pilotes
   * Windows) — et son verdict vaut pour les trois suivantes.
   *
   * ponytail : une tentative réelle plutôt qu'une sonde `navigator.gpu` ici.
   * Avec `proxy = true`, c'est le worker qui initialise WebGPU, pas ce
   * thread-ci : le tester d'ici répondrait à la mauvaise question. Le coût est
   * une création de session sur le plus petit des quatre modèles.
   */
  let ep: "webgpu" | "wasm" = "webgpu"
  const sessions: ort.InferenceSession[] = []
  for (let i = 0; i < onnxFiles.length; i++) {
    onProgress?.({ name: onnxFiles[i]!.label, index: i, total: onnxFiles.length })
    const buf = await getFile(onnxFiles[i]!.name)
    try {
      sessions.push(await ORT.InferenceSession.create(buf, { executionProviders: [ep] }))
    } catch (e) {
      // Seule la première session est une sonde : une fois l'EP retenu, un
      // échec plus loin est une vraie erreur, pas un verdict de plateforme.
      if (i > 0 || ep === "wasm") throw e
      console.info("[orateur] WebGPU indisponible, repli WASM :", e)
      ep = "wasm"
      sessions.push(await ORT.InferenceSession.create(buf, { executionProviders: [ep] }))
    }
  }
  console.info(`[orateur] moteur ONNX sur ${ep} (numThreads=${ORT.env.wasm.numThreads})`)

  return new TextToSpeech(cfgs, textProcessor, sessions[0]!, sessions[1]!, sessions[2]!, sessions[3]!)
}

export function chunkText(text: string, maxLen = 300): string[] {
  if (typeof text !== "string") throw new Error(`chunkText expects a string`)

  const paragraphs = text
    .trim()
    .split(/\n\s*\n+/)
    .filter((p) => p.trim())

  const chunks: string[] = []

  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim()
    if (!paragraph) continue

    // Le japonais et le coréen terminent leurs phrases par 。！？ sans espace
    // derrière : sans l'alternative de largeur nulle, un paragraphe CJK entier
    // ne formait qu'un seul chunk, quel que soit maxLen.
    const sentences = paragraph
      .split(
        /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+|(?<=[。！？])/
      )
      // ponytail : virgules CJK en dernier recours pour une phrase encore plus
      // longue que maxLen ; pas de coupe au caractère, à ajouter si une phrase
      // sans ponctuation interne devient un problème.
      .flatMap((s) => (s.length > maxLen ? s.split(/(?<=[、，；])/) : [s]))
      .map((s) => s.trim())
      .filter(Boolean)

    let currentChunk = ""
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length + 1 <= maxLen) {
        // Pas d'espace ajouté derrière une ponctuation CJK : le japonais et le
        // coréen n'en mettent pas entre deux phrases.
        const sep = currentChunk && !/[。！？、，；]$/.test(currentChunk) ? " " : ""
        currentChunk += sep + sentence
      } else {
        if (currentChunk) chunks.push(currentChunk.trim())
        currentChunk = sentence
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim())
  }

  return chunks.map((chunk) => {
    if (!/[.!?;:,'")\]}…。、，；」』】〉》›»]$/.test(chunk)) return chunk + "."
    return chunk
  })
}

export function writeWavFile(audioData: ArrayLike<number>, sampleRate: number): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const dataSize = audioData.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, "data")
  view.setUint32(40, dataSize, true)

  const int16 = new Int16Array(audioData.length)
  for (let i = 0; i < audioData.length; i++) {
    int16[i] = Math.floor(Math.max(-1, Math.min(1, audioData[i]!)) * 32767)
  }
  new Uint8Array(buffer, 44).set(new Uint8Array(int16.buffer))
  return buffer
}
