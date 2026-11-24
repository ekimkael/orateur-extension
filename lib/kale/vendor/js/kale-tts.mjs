// Kale's browser API, adapted to Orateur's asset reader and explicit backend.
// The voice's accent tag in voices.json (en-us / en-gb) picks the pronunciation front end by itself.
// Front end: tech terms -> number/date rules (dizione) -> CMUdict lexicon + overrides + g2p model -> IPA -> ids.
// Pace comes from the model: speed is always 1.0, no multiplier.
import { G2p, G2pModel, normalizer, readTable, sentences } from "../frontend/words/kaleTts.js";
import { EttinTokenizer, ettinInputs, wordIndex } from "../frontend/ettin.js";

import { loadEnGB } from "../frontend/release-loader.mjs";
const SAMPLE_RATE = 24000;
const GAP_S = 0.12;          // silence between sentences in speak()
const MAX_IDS = 500;         // one model call at most (cut at a space)

// Orateur supplies a verified, abortable asset reader.
const textReader = (readBytes) => async (url) => new TextDecoder().decode(await readBytes(url));
const join = (base, p) => (base.endsWith("/") ? base : base + "/") + p;

// ------------------------------------------------------------------------------------------- front ends
/** the terms dictionary: whole tokens, longest first, case as written; camelCase split; again */
function termsReplacer(table) {
  const terms = readTable(table);
  if (terms.size === 0) return (t) => t;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // a written form starting with "." is a suffix too: ".js" also matches in "Node.js"
  const forms = [...terms.keys()].sort((a, b) => b.length - a.length).map((f) => (f.startsWith(".") ? esc(f) : `(?<![\\p{L}\\p{N}_])${esc(f)}`));
  const pattern = new RegExp(`(?:${forms.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const lookUp = (t) => t.replace(pattern, (f, at, whole) => {
    const spoken = terms.get(f) ?? f;
    return f.startsWith(".") && at > 0 && /[\p{L}\p{N}]/u.test(whole[at - 1]) ? ` ${spoken}` : spoken;   // "Node.js" -> "Node dot J S"
  });
  const CAMEL = /(?<![\p{L}\p{N}_])[a-z]+(?:[A-Z][a-z0-9]*)+(?![\p{L}\p{N}_])/gu;
  const split = (t) => t.replace(CAMEL, (w) => w.replace(/(?<=[a-z0-9])(?=[A-Z])/g, " "));
  return (t) => lookUp(split(lookUp(t)));
}

/** Front ends per accent: either the four front-end files (g2pModel, lexicon, override, terms;
 *  paths relative to the front-end folder or absolute URLs) or a loader (frontendBase) => { sentences, ipa } such as loadEnGB.
 *  An accent with no front end falls back to en-us. */
// WebGPU: since onnxruntime-web 1.27 the 6 small LSTM layers run on a WebGPU kernel that is ~3x slower for this model than the CPU;
// keeping them on the CPU gives nano 78x -> 113x, tiny 29x -> 81x (runtimes/transformers-js/upstream/UPSTREAM.md). Names for both graphs
// (nano's sit under "/g", tiny's don't); a name a graph doesn't have is ignored. A caller's own { name: "webgpu", ... } object is kept.
const LSTM_NODES = ["lstms.0", "lstms.2", "lstms.4", "lstm", "shared", "lstm_1"].flatMap((n) => [`/g/${n}/LSTM`, `/${n}/LSTM`]);
const webgpuOptions = (ep) => (ep === "webgpu" ? { name: "webgpu", forceCpuNodeNames: LSTM_NODES } : ep);

// British front end (../frontend/release-loader.mjs, loadEnGB): OFF. Today's weights were trained on en-us ids only, so d03 / d13
// (accent en-gb in voices.json) read through en-us. It goes on together with the en-gb fine-tuned weights; then set this to true.
const EN_GB_ON = true;   // 16 Nov: the 10-voice files read Amy (d03) / Jack (d13) through en-gb ids
const FRONT_ENDS = {
  "en-us": { g2pModel: "words/g2p.bin", lexicon: "words/lexicon.tsv", override: "words/override.public.tsv", terms: "words/terms.tsv" },
  "en-gb": EN_GB_ON ? loadEnGB : null,
};

async function buildFrontEnd(frontendBase, files, readBytes) {
  if (typeof files === "function") return files(frontendBase, readBytes);
  const readText = textReader(readBytes);
  const at = (p) => (/^(https?:|\/)/.test(p) ? p : join(frontendBase, p));
  const [g2pBin, lexicon, override, terms] = await Promise.all([readBytes(at(files.g2pModel)), readText(at(files.lexicon)),
    readText(at(files.override)), readText(at(files.terms))]);
  const lex = readTable(lexicon); readTable(override, lex);
  const g2p = new G2p(lex, new G2pModel(g2pBin)); const norm = normalizer(lex); const applyTerms = termsReplacer(terms);
  const normalize = (t) => norm(applyTerms(t));
  return { sentences: (text) => sentences(text, normalize), ipa: (s) => g2p.phonemes(s) };
}


// Kokoro-native phoneme ids (voices.json "phonemes": "kokoro-native", the 17 Nov kale-tts-1-tiny): the model was trained on Kokoro's own
// symbols, so the release IPA is rewritten before the id lookup. en-us: eɪ A, aɪ I, aʊ W, oʊ O, ɔɪ Y, tʃ ʧ, dʒ ʤ, no ː, ɚ əɹ, ɝ ɜɹ, ɾ T;
// en-gb: the same pairs with əʊ Q, length marks kept, no rhotic / flap rules; both: ə + l/n/m at a word end after a
// consonant -> ᵊ. Same output as the training conversion (k20c kn_tokens.convert / kn_ids.gb_w), checked on the 418 bench sentences.
const KN_PAIRS = { "eɪ": "A", "aɪ": "I", "aʊ": "W", "ɔɪ": "Y", "tʃ": "ʧ", "dʒ": "ʤ" };
const KN_VOW = new Set([..."aeiouɑɐɒæəɘɚɛɜɝɞɪɨʊʉʌɔøœɤɯʏyAIWOYᵊᵻ"]), KN_END = new Set([..." .,!?;:"]);
export function knIPA(chars, gb) {   // chars: the IPA characters that have ids (already filtered by the table)
  const pairs = { ...KN_PAIRS, ...(gb ? { "əʊ": "Q" } : { "oʊ": "O" }) }, out = [];
  for (let i = 0; i < chars.length;) {
    const two = chars[i] + (chars[i + 1] ?? "");
    if (pairs[two]) { out.push(pairs[two]); i += 2; continue; }
    const c = chars[i++];
    if (gb) { out.push(c); continue; }
    if (c === "ː") continue;
    if (c === "ɚ") out.push("ə", "ɹ"); else if (c === "ɝ") out.push("ɜ", "ɹ"); else if (c === "ɾ") out.push("T"); else out.push(c);
  }
  for (let k = 1; k < out.length - 1; k++)
    if (out[k] === "ə" && "lnm".includes(out[k + 1]) && (k + 2 === out.length || KN_END.has(out[k + 2])) && !KN_VOW.has(out[k - 1]) &&
        !"ˈˌ".includes(out[k - 1]) && !/\s/.test(out[k - 1])) out[k] = "ᵊ";
  return out;
}

// ------------------------------------------------------------------------------------------- the model
export class KaleTTS {
  /** files: { g2pModel, lexicon, override, terms } (the four front-end files, relative to the front-end folder or absolute URLs), or a
   *  loader (frontendBase) => { sentences, ipa }, e.g. KaleTTS.registerFrontEnd("en-gb", loadEnGB). Only use en-gb with weights trained
   *  on en-gb ids. Takes effect for models loaded after the call. */
  static registerFrontEnd(accent, filesOrLoader) { FRONT_ENDS[accent] = filesOrLoader; }

  /** Load the selected graph, using readBytes for the supplied model and frontend paths. */
  static async load(base, { ort, frontend: feBase, readBytes, threads, graph, executionProviders, sessionOptions = {} }) {
    const readText = textReader(readBytes);
    const file = (g) => ({ int8: "model.onnx", fp32: "model.fp32.onnx" })[g] ?? g;
    const [voicesJson, tok] = await Promise.all([readText(join(base, "voices.json")), readText(join(base, "tokenizer.json"))]);
    const bytes = new Uint8Array(await readBytes(join(base, file(graph))));
    const session = await ort.InferenceSession.create(bytes, {
      logSeverityLevel: 3, ...(threads ? { intraOpNumThreads: threads } : {}), ...sessionOptions,
      executionProviders: executionProviders.map(webgpuOptions),
    });
    try {
      const tts = new KaleTTS(ort, session, base, feBase, JSON.parse(voicesJson), JSON.parse(tok).model.vocab, readBytes);
      if (session.inputNames.includes("ettin_ids"))
        tts.ettinTok = new EttinTokenizer(JSON.parse(await readText(join(base, "ettin-tokenizer.json"))));
      return tts;
    } catch (error) {
      await session.release();
      throw error;
    }
  }

  constructor(ort, session, base, feBase, voicesJson, vocab, readBytes) {
    Object.assign(this, { ort, session, base, feBase, vocab, sampleRate: SAMPLE_RATE, readBytes });
    this.voiceInputs = voicesJson.voice_inputs; this.voices = voicesJson.voices; this._voice = {}; this._fe = {};
    this.kn = voicesJson.phonemes === "kokoro-native";
  }

  resolveVoice(voice) {
    const k = String(voice).trim().toLowerCase();
    const v = this.voices.find((x) => x.id.toLowerCase() === k || (x.name ?? "").toLowerCase() === k || (x.aliases ?? []).includes(k));   // aliases: earlier names
    if (!v) throw new Error(`unknown voice ${voice}; voices: ${this.voices.map((x) => (x.name ? `${x.name.toLowerCase()} (${x.id})` : x.id)).join(", ")}`);
    return v.id;
  }

  async _frontEnd(accent) {
    const a = FRONT_ENDS[accent] ? accent : "en-us";   // en-gb off (see EN_GB_ON): d03 / d13 read through en-us, as trained
    return (this._fe[a] ??= buildFrontEnd(this.feBase, FRONT_ENDS[a], this.readBytes).catch((e) => { delete this._fe[a]; throw e; }));
  }

  /** load voices (default: all) and their front ends now, so later speak()/stream() calls need no network. Returns the loaded ids. */
  async preload(voices = this.voices.map((v) => v.id)) {
    const ids = typeof voices === "string" ? [voices] : [...voices];
    await Promise.all(ids.map((id) => this._loadVoice(id)));
    return ids;
  }

  _loadVoice(voice) {   // cached per voice (the promise, so parallel callers share one fetch); a failed load can be retried
    const id = this.resolveVoice(voice);
    return (this._voice[id] ??= this._fetchVoice(id).catch((e) => { delete this._voice[id]; throw e; }));
  }

  async _fetchVoice(id) {
    const v = this.voices.find((x) => x.id === id);
    const [st, ex, fe] = await Promise.all([this.readBytes(join(this.base, `voices/${id}.bin`)), this.readBytes(join(this.base, `voices/${id}.extra.bin`)),
      this._frontEnd(v.accent ?? "en-us")]);
    // only files that are what voices.json says they are (a web server can answer a missing file with an HTML page and status 200)
    const need = this.voiceInputs.reduce((n, vi) => n + vi.dims.reduce((a, b) => a * b, 1), 0) * 4;
    if (st.byteLength === 0 || st.byteLength % (256 * 4) !== 0)
      throw new Error(`voice ${id}: voices/${id}.bin is ${st.byteLength} bytes, not a style table of 256-float rows (wrong file or an error page?)`);
    if (ex.byteLength !== need)
      throw new Error(`voice ${id}: voices/${id}.extra.bin is ${ex.byteLength} bytes, voices.json's voice_inputs need ${need} (wrong file or an error page?)`);
    const style = new Float32Array(st), extra = new Float32Array(ex), feeds = {}; let o = 0;
    for (const vi of this.voiceInputs) { const n = vi.dims.reduce((a, b) => a * b, 1); feeds[vi.name] = new this.ort.Tensor("float32", extra.slice(o, o + n), vi.dims); o += n; }
    return { meta: v, style, feeds, fe };
  }

  async _probe() {   // a 3-token run with neutral voice inputs (also compiles the WebGPU shaders for short inputs)
    const T = this.ort.Tensor, feeds = { input_ids: new T("int64", BigInt64Array.from([0n, 50n, 0n]), [1, 3]),
      style: new T("float32", new Float32Array(256), [1, 256]), speed: new T("float32", Float32Array.from([1]), [1]) };
    for (const vi of this.voiceInputs) feeds[vi.name] = new T("float32", new Float32Array(vi.dims.reduce((a, b) => a * b, 1)), vi.dims);
    if (this.ettinTok) Object.assign(feeds, { ettin_ids: new T("int64", BigInt64Array.from([BigInt(this.ettinTok.cls), BigInt(this.ettinTok.sep)]), [1, 2]),
      ettin_mask: new T("int64", BigInt64Array.from([1n, 1n]), [1, 2]), wavg: new T("float32", new Float32Array(2), [1, 1, 2]),
      widx: new T("int64", new BigInt64Array(3), [1, 3]) });
    await this.session.run(feeds);
  }

  async _ids(ipa, accent = "en-us") {
    const chars = [...ipa].filter((c) => this.vocab[c] !== undefined);
    return (this.kn ? knIPA(chars, accent === "en-gb") : chars).map((c) => this.vocab[c]).filter((x) => x !== undefined);
  }

  async _render(voice, ids, words) {
    const rows = voice.style.length / 256, row = Math.min(ids.length, rows) - 1, T = this.ort.Tensor;
    const x = BigInt64Array.from([0, ...ids, 0].map(BigInt)), big = (a) => BigInt64Array.from(a.map(BigInt));
    const feeds = { input_ids: new T("int64", x, [1, x.length]), style: new T("float32", voice.style.slice(row * 256, (row + 1) * 256), [1, 256]),
      speed: new T("float32", Float32Array.from([1]), [1]), ...voice.feeds };
    if (words) {   // Ettin inputs for this sentence: sub-tokens (previous sentence as left context), word averages, word per sound id
      const { e, widx } = words;
      Object.assign(feeds, { ettin_ids: new T("int64", big(e.ettin_ids), [1, e.S]), ettin_mask: new T("int64", big(e.ettin_mask), [1, e.S]),
        wavg: new T("float32", e.wavg, [1, e.W, e.S]), widx: new T("int64", big([widx[0], ...widx, widx[widx.length - 1]]), [1, widx.length + 2]) });
    }
    const out = await this.session.run(feeds);
    return out[this.session.outputNames[0]].data;
  }

  /** text -> one Float32Array at 24 kHz (sentences joined with a short pause) */
  async speak(text, { voice = this.voices[0].id } = {}) {
    const parts = []; for await (const c of this.stream(text, { voice })) parts.push(c.audio, new Float32Array(Math.round(GAP_S * SAMPLE_RATE)));
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { audio.set(p, at); at += p.length; }
    return { audio, sampleRate: SAMPLE_RATE };
  }

  /** sentence by sentence: yields { text, ipa, audio } as each sentence is ready */
  async *stream(text, { voice = this.voices[0].id } = {}) {
    const v = await this._loadVoice(voice); let prev = "";
    for (const s of v.fe.sentences(text)) {
      const ipa = v.fe.ipa(s); const chunks = []; let rest = [...ipa];
      while (rest.length > MAX_IDS) { let cut = rest.lastIndexOf(" ", MAX_IDS); if (cut <= 0) cut = MAX_IDS; chunks.push(rest.slice(0, cut).join("")); rest = rest.slice(cut + 1); }
      chunks.push(rest.join(""));
      let ew = null, at = 0;
      if (this.ettinTok) {   // word features for the whole sentence; each chunk gets its slice of the word index
        const acc = v.meta.accent ?? "en-us", words = s.split(/\s+/).filter(Boolean), all = await this._ids(ipa, acc), per = await Promise.all(words.map((w) => this._ids(v.fe.ipa(w), acc)));
        ew = { e: ettinInputs(this.ettinTok, s, prev), widx: wordIndex(all, per, words.length), all };
      }
      for (const c of chunks) {
        const ids = await this._ids(c, v.meta.accent ?? "en-us");
        if (ew) { while (at < ew.all.length && ew.all[at] !== ids[0]) at++; }   // chunks drop the space they were cut at
        if (ids.length) yield { text: s, ipa: c, audio: await this._render(v, ids, ew && { e: ew.e, widx: ew.widx.slice(at, at + ids.length) }) };
        at += ids.length;
      }
      prev = s;
    }
  }
}

/** 16-bit PCM WAV bytes (for saving / an <audio> element) */
export function toWav(audio, sampleRate = SAMPLE_RATE) {
  const b = new ArrayBuffer(44 + audio.length * 2), d = new DataView(b), w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); d.setUint32(4, 36 + audio.length * 2, true); w(8, "WAVEfmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sampleRate, true); d.setUint32(28, sampleRate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, "data"); d.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 32767, true);
  return new Uint8Array(b);
}
