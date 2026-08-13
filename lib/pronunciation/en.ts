/**
 * English rules. Same two layers as `fr.ts`.
 *
 * `PHONETIC` is deliberately empty: English system voices already read the
 * common French loanwords (`cliché`, `rendezvous`, `entrepreneur`) acceptably,
 * and we do not ship respellings nobody has heard. Add entries here when a
 * concrete word is heard failing — accented proper nouns are the likely first
 * candidates.
 */

export const VERBALIZE: [RegExp, string][] = [
  [/\be\.g\.\s*/gi, 'for example, '],
  [/\bi\.e\.\s*/gi, 'that is, '],
  [/\betc\.\s*/gi, 'et cetera. '],
  [/\bvs\.\s*/gi, 'versus '],
  [/\bDr\.?(?=\s)/g, 'Doctor'],
  [/\bMr\.?(?=\s)/g, 'Mister'],
  [/\bMrs\.?(?=\s)/g, 'Missus'],
  [/(\d+)\s*%/g, '$1 percent'],
  [/(\d+)\+/g, '$1 or more'],
  [/\b1st\b/g, 'first'],
  [/\b2nd\b/g, 'second'],
  [/\b3rd\b/g, 'third'],
  [/→/g, ' to '],
  [/×/g, ' times '],
  [/\+(?=\s)/g, ' plus '],
];

export const PHONETIC: [RegExp, string][] = [];
