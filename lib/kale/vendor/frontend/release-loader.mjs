// The en-gb front-end loader (16 Nov). For the release: it reads en-gb/override.public.tsv (the en-gb
// override minus the same 51 entries dropped from the public en-us list, OVERRIDE-REVIEW.md).
// The en-gb loader for the release's JS API (release-draft/js/kale-tts.mjs), the same shape as its loadEnUS:
//   import { loadEnGB } from "../frontend/release-loader.mjs";  KaleTTS.registerFrontEnd("en-gb", loadEnGB);
// or put loadEnGB into FRONT_ENDS["en-gb"] directly. voices.json "accent": "en-gb" then picks it by itself (d03, d13).
// Files: <frontend>/words/en-gb/{lexicon.tsv, override.public.tsv, terms.tsv, g2p.bin} + <frontend>/words/enGb.js.
// The model's tokenizer.json needs "ɒ": 71 (vocab + normaliser regex); every other en-gb symbol is in it already.
import { G2pModel, readTable, sentences } from "./words/kaleTts.js";
import { BritishG2p, britishNormalizer } from "./words/enGb.js";

const join = (base, p) => (base.endsWith("/") ? base : base + "/") + p;

/** terms table: whole tokens, longest first; camelCase split; again (same as the release's en-us) */
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

/** British English: files under <frontend>/words/en-gb/ */
export async function loadEnGB(frontendBase, readBytes) {
  const readText = async (url) => new TextDecoder().decode(await readBytes(url));
  const d = join(frontendBase, "words/en-gb/");
  const [lexicon, override, terms, g2pBin] = await Promise.all([readText(d + "lexicon.tsv"), readText(d + "override.public.tsv"),
    readText(d + "terms.tsv"), readBytes(d + "g2p.bin")]);
  const lex = readTable(lexicon); readTable(override, lex);
  const g2p = new BritishG2p(lex, new G2pModel(g2pBin)); const norm = britishNormalizer(lex); const terms_ = termsReplacer(terms);
  const normalize = (t) => norm(terms_(t));
  return { sentences: (text) => sentences(text, normalize), ipa: (s) => g2p.phonemes(s) };
}
