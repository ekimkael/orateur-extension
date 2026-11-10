/**
 * Turns displayed text into text to be spoken. Three layers, from the most
 * general to the most engine-specific:
 *
 *  1. `UNIVERSAL` — punctuation that reads the same in every language. Applied
 *     always, neural engine included.
 *  2. `VERBALIZE` (per language) — symbols and abbreviations spelled out as
 *     words. Applied always: `→` is « vers » in French and ` to ` in English, so
 *     it cannot live in layer 1.
 *  3. `PHONETIC` (per language) + acronym spelling — for system voices only. A
 *     multilingual neural engine handles loanwords on its own and these rewrites
 *     degrade it, hence `skipPhonetic`.
 *
 * Adding a language = one file, one import, one entry in `LANGUAGES`. A language
 * with no file falls back to layer 1 alone rather than to French rules.
 *
 * The result is **for speaking only**, never for display.
 *
 * Imports carry an explicit `.ts` extension so the whole graph stays runnable
 * through `node lib/pronunciation.check.ts`.
 */
import * as en from './en.ts';
import * as fr from './fr.ts';
import { splitPronunciationSegments, type PronunciationRule } from './personal.ts';
import { normalizeSpokenNumbers, verbalizeNumericForms } from './numbers.ts';

export type { PronunciationRule } from './personal.ts';

type LanguageRules = { VERBALIZE: [RegExp, string][]; PHONETIC: [RegExp, string][]; NEVER_SPELLED?: ReadonlySet<string> };

const LANGUAGES: Record<string, LanguageRules> = { en, fr };

const UNIVERSAL: [RegExp, string][] = [
  [/\s*—\s*/g, ', '],
  [/«\s*/g, '"'],
  [/\s*»/g, '"'],
  [/…/g, '... '],
  [/;/g, ','],
  // A colon becomes a pause, except between digits (« 14:30 », « 3:1 ») and
  // before a slash (« https:// »).
  [/(\D)\s*:\s*(?!\/)/g, '$1, '],
];

/**
 * Two-to-three-capital tokens a voice reads better as a word than as letters.
 * Nearly all of them are ordinary words written in capitals for emphasis — a
 * headline convention, so imported articles are full of them — not acronyms.
 * The 4-and-above rule below covers the long ones (`STOP`, `ATTENTION`); this
 * set is the short ones. Add to it as you hear one spelled out.
 */
const NEVER_SPELLED = new Set([
  'OK',
  'NON',
  'OUI',
  'PAS',
  'TOP',
  'NEW',
  'VS',
  'BIS',
  'FIN',
]);

/** Four-letter acronyms; anything else that long is treated as a shouted word. */
const ALWAYS_SPELLED = new Set(['HTML', 'JSON']);

/**
 * Spaces out the letters of an acronym so each voice spells it in its own
 * language — « ah-pé-ee » in French, « ay-pee-eye » in English. Replaces the
 * per-language list of hand-written acronyms it used to take.
 *
 * Two to three characters are spelled; four and above are left to the
 * capitalisation pass below, so « STOP » or « BREF » stay words. Needs at least
 * two capitals, which keeps numbers (`30`, `2024`) out.
 */
function spellAcronyms(text: string, neverSpelled?: ReadonlySet<string>): string {
  // Unicode word edges, not `\b`: JavaScript's `\b` is ASCII-only and would
  // spell the « NIN » of « BÉNIN ».
  return text.replace(/(?<![\p{L}\p{M}\p{N}_])([A-Z0-9]{2,4})(s?)(?![\p{L}\p{M}\p{N}_])/gu, (match, token: string, plural: string) => {
    if (NEVER_SPELLED.has(token) || neverSpelled?.has(token)) return match;
    if (token.replace(/[^A-Z]/g, '').length < 2) return match;
    if (token.length === 4 && !ALWAYS_SPELLED.has(token)) return match;
    // The plural `s` gets its own space too: glued on, « A P Is » is read as the
    // word "is" instead of the letter.
    return token.split('').join(' ') + (plural && ' s');
  });
}

/**
 * A sentence written all in capitals, a headline shouted for the feed, read in
 * lower case except its first letter. Two-to-three-letter tokens that are not
 * known words stay capitals, so acronyms (« BIR ») are still spelled.
 *
 * Why the whole sentence: Supertonic read a capital « ET » as « et il », and a
 * capital on every word (« Refuse D’Extrader ») broke words apart. Capitals
 * inside an ordinary sentence are emphasis and keep the per-word rule below.
 */
function quietShouting(text: string, neverSpelled?: ReadonlySet<string>): string {
  return text.replace(/[^.!?…]+[.!?…]*/gu, (sentence) => {
    if (/\p{Ll}/u.test(sentence)) return sentence;
    if ((sentence.match(/\p{L}{2,}/gu) ?? []).length < 2) return sentence;
    let first = true;
    return sentence.replace(/[\p{L}\p{M}]+/gu, (word) => {
      const acronym = /^[A-Z]{2,3}$/.test(word) && !NEVER_SPELLED.has(word) && !neverSpelled?.has(word);
      const kept = acronym || ALWAYS_SPELLED.has(word) ? word : (first ? word.charAt(0) : word.charAt(0).toLowerCase()) + word.slice(1).toLowerCase();
      first = false;
      return kept;
    });
  });
}

export function expandText(
  raw: string,
  options?: { language?: string; skipPhonetic?: boolean; personalRules?: readonly PronunciationRule[] }
): string {
  const language = options?.language ?? 'fr';
  const segments = splitPronunciationSegments(raw, language, options?.personalRules ?? []);
  return segments.map((segment, index) => segment.protected
    ? segment.text
    : expandBuiltins(segment.text, language, options?.skipPhonetic, index > 0)
  ).join('').replace(/\s+/g, ' ').trim();
}

function expandBuiltins(raw: string, language: string, skipPhonetic = false, afterReplacement = false): string {
  // Two-letter code, French by default — same convention as reading-intro,
  // reading-outro and reader-prefs.
  const rules = LANGUAGES[language.slice(0, 2).toLowerCase()];
  // Preserve left context for punctuation ("API : suite") without exposing
  // any personal replacement to the builtins. Every builtin leaves this marker intact.
  const prefix = afterReplacement ? '\uE000' : '';
  let result = verbalizeNumericForms(normalizeSpokenNumbers(prefix + raw, language), language);

  for (const [pattern, replacement] of UNIVERSAL) result = result.replace(pattern, replacement);

  if (rules) {
    for (const [pattern, replacement] of rules.VERBALIZE) {
      result = result.replace(pattern, replacement);
    }
  }

  result = quietShouting(result, rules?.NEVER_SPELLED);

  if (!skipPhonetic) {
    if (rules) {
      for (const [pattern, replacement] of rules.PHONETIC) {
        result = result.replace(pattern, replacement);
      }
    }
    result = spellAcronyms(result, rules?.NEVER_SPELLED);
  }

  // Lowercasing long all-caps words applies in every case: without it the voices
  // spell them out letter by letter. Known acronyms are left alone — turning
  // `JSON` into `Json` hands the neural engine a fake word instead of letters.
  return result
    .replace(/(?<![\p{L}\p{M}\p{N}_])\p{Lu}{4,}(?![\p{L}\p{M}\p{N}_])/gu, (word) =>
      ALWAYS_SPELLED.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()
    ).slice(prefix.length);
}
