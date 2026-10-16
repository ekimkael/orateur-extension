const NUMERIC_SPAN = /[+-]?\d+(?:[ \u00a0\u202f]+\d+|[,.]\d+)*/g;
const WORD_BEFORE = /[\p{L}\p{M}\p{N}_]$/u;
const WORD_AFTER = /^[\p{L}\p{M}\p{N}_]/u;
const GROUPED_FRENCH = /^[+-]?[1-9]\d{0,2}(?:[ \u00a0\u202f]+\d{3})+(?:,\d+)?$/;
const GROUPED_ENGLISH = /^[+-]?[1-9]\d{0,2}(?:(?:,\d{3})+|(?:[ \u00a0\u202f]+\d{3})+)(?:\.\d+)?$/;

/** Remove thousands separators for speech; displayed text stays untouched. */
export function normalizeSpokenNumbers(text: string, language: string): string {
  const lang = language.slice(0, 2).toLowerCase();
  if (lang !== 'fr' && lang !== 'en') return text;

  return text.replace(NUMERIC_SPAN, (number, offset: number) => {
    // Match the entire numeric span so malformed groups, telephone numbers,
    // versions and zero-prefixed codes cannot have only a suffix rewritten.
    if (WORD_BEFORE.test(text.slice(Math.max(0, offset - 2), offset)) ||
        WORD_AFTER.test(text.slice(offset + number.length, offset + number.length + 2))) return number;
    const grouped = lang === 'fr' ? GROUPED_FRENCH : GROUPED_ENGLISH;
    if (!grouped.test(number)) return number;
    return number.replace(lang === 'fr' ? /[ \u00a0\u202f]/g : /[, \u00a0\u202f]/g, '');
  });
}
