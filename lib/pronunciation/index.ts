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

type LanguageRules = { VERBALIZE: [RegExp, string][]; PHONETIC: [RegExp, string][] };

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
function spellAcronyms(text: string): string {
  return text.replace(/\b([A-Z0-9]{2,4})(s?)\b/g, (match, token: string, plural: string) => {
    if (NEVER_SPELLED.has(token)) return match;
    if (token.replace(/[^A-Z]/g, '').length < 2) return match;
    if (token.length === 4 && !ALWAYS_SPELLED.has(token)) return match;
    // The plural `s` gets its own space too: glued on, « A P Is » is read as the
    // word "is" instead of the letter.
    return token.split('').join(' ') + (plural && ' s');
  });
}

export function expandText(
  raw: string,
  options?: { language?: string; skipPhonetic?: boolean }
): string {
  // Two-letter code, French by default — same convention as reading-intro,
  // reading-outro and reader-prefs.
  const rules = LANGUAGES[(options?.language ?? 'fr').slice(0, 2).toLowerCase()];
  let result = raw;

  for (const [pattern, replacement] of UNIVERSAL) result = result.replace(pattern, replacement);

  if (rules) {
    for (const [pattern, replacement] of rules.VERBALIZE) {
      result = result.replace(pattern, replacement);
    }
  }

  if (!options?.skipPhonetic) {
    if (rules) {
      for (const [pattern, replacement] of rules.PHONETIC) {
        result = result.replace(pattern, replacement);
      }
    }
    result = spellAcronyms(result);
  }

  // Lowercasing long all-caps words applies in every case: without it the voices
  // spell them out letter by letter. Known acronyms are left alone — turning
  // `JSON` into `Json` hands the neural engine a fake word instead of letters.
  return result
    .replace(/\b([A-ZÀ-Ü]{4,})\b/g, (word) =>
      ALWAYS_SPELLED.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()
    )
    .replace(/\s+/g, ' ')
    .trim();
}
