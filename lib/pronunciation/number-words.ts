/**
 * Spells numbers out as words for Supertonic, which reads digits poorly —
 * French worst of all. System voices read digits natively, so this runs in the
 * Supertonic preprocessing only. French and English; other languages untouched.
 */

const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const FR_TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

function frBelow100(n: number): string {
  if (n <= 16) return FR_UNITS[n]!;
  if (n < 20) return `dix-${FR_UNITS[n - 10]}`;
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (tens === 7) return unit === 1 ? 'soixante et onze' : `soixante-${frBelow100(10 + unit)}`;
  if (tens === 8) return unit === 0 ? 'quatre-vingts' : `quatre-vingt-${FR_UNITS[unit]}`;
  if (tens === 9) return `quatre-vingt-${frBelow100(10 + unit)}`;
  if (unit === 0) return FR_TENS[tens]!;
  return unit === 1 ? `${FR_TENS[tens]} et un` : `${FR_TENS[tens]}-${FR_UNITS[unit]}`;
}

/** `final`: « vingts » and « cents » keep their plural `s` only at the end of the number. */
function frBelow1000(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(hundreds === 1 ? 'cent' : `${FR_UNITS[hundreds]} cent${rest === 0 && final ? 's' : ''}`);
  if (rest) parts.push(frBelow100(rest));
  const words = parts.join(' ');
  return final ? words : words.replace(/quatre-vingts$/, 'quatre-vingt');
}

export function frCardinal(n: number): string {
  if (n === 0) return FR_UNITS[0]!;
  const parts: string[] = [];
  for (const [value, name] of [[1e9, 'milliard'], [1e6, 'million']] as const) {
    const count = Math.floor(n / value);
    if (count) parts.push(`${frBelow1000(count, true)} ${name}${count > 1 ? 's' : ''}`);
    n %= value;
  }
  const thousands = Math.floor(n / 1000);
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${frBelow1000(thousands, false)} mille`);
  if (n % 1000) parts.push(frBelow1000(n % 1000, true));
  return parts.join(' ');
}

function enBelow100(n: number): string {
  if (n < 20) return EN_UNITS[n]!;
  return EN_TENS[Math.floor(n / 10)]! + (n % 10 ? `-${EN_UNITS[n % 10]}` : '');
}

export function enCardinal(n: number): string {
  if (n === 0) return EN_UNITS[0]!;
  const parts: string[] = [];
  for (const [value, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']] as const) {
    const count = Math.floor(n / value);
    n %= value;
    if (!count) continue;
    const hundreds = Math.floor(count / 100);
    const chunk = [hundreds ? `${EN_UNITS[hundreds]} hundred` : '', count % 100 ? enBelow100(count % 100) : '']
      .filter(Boolean).join(' ');
    parts.push(name ? `${chunk} ${name}` : chunk);
  }
  return parts.join(' ');
}

function frOrdinal(n: number, feminine: boolean): string {
  if (n === 1) return feminine ? 'première' : 'premier';
  return frCardinal(n)
    .replace(/(vingt|cent)s$/, '$1')
    .replace(/cinq$/, 'cinqu')
    .replace(/neuf$/, 'neuv')
    .replace(/e$/, '') + 'ième';
}

function enOrdinal(n: number): string {
  const irregular: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  return enCardinal(n).replace(/[a-z]+$/, (last) => irregular[last] ?? last.replace(/y$/, 'ie') + 'th');
}

/** « nineteen ninety-nine », « twenty twenty-four »; 2000–2009 stay cardinal. */
function enYear(n: number): string {
  if (n < 1100 || n > 2099 || (n >= 2000 && n <= 2009)) return enCardinal(n);
  const low = n % 100;
  return `${enBelow100(Math.floor(n / 100))} ${low === 0 ? 'hundred' : low < 10 ? `oh ${EN_UNITS[low]}` : enBelow100(low)}`;
}

export function spellNumbers(text: string, language: string): string {
  const lang = language.slice(0, 2).toLowerCase();
  if (lang !== 'fr' && lang !== 'en') return text;
  const fr = lang === 'fr';
  const cardinal = fr ? frCardinal : enCardinal;
  // Zero-padded runs (« code007 », « v1.02 ») and, as a ponytail ceiling, runs
  // past 12 digits are read digit by digit.
  const integer = (digits: string) => digits.length > 12 || /^0\d/.test(digits)
    ? digits.split('').map((d) => cardinal(+d)).join(' ')
    : cardinal(+digits);
  // A number glued to letters (« G7 », « 3D », « A380 ») gets spaces so it is a word of its own.
  const pad = (words: string, all: string, offset: number, length: number) =>
    (/[\p{L}\p{M}]$/u.test(all.slice(0, offset)) ? ' ' : '') + words + (/^\p{L}/u.test(all.slice(offset + length)) ? ' ' : '');

  let result = text
    .replace(/(?<![\p{L}\p{N}])-(?=\d)/gu, fr ? 'moins ' : 'minus ')
    .replace(/(?<![\p{L}\p{N}])\+(?=\d)/gu, 'plus ')
    .replace(/(\d)\s*-\s*(?=\d)/g, '$1 - ')
    // A two-digit right side is a time the builtins did not see (« 14:05 »), not a ratio.
    .replace(/(?<!\d)(\d{1,2}):(\d\d)(?!\d)/g, (_, h: string, m: string) => fr
      ? `${frCardinal(+h)} heure${+h > 1 ? 's' : ''}${+m ? ` ${frCardinal(+m)}` : ''}`
      : enCardinal(+h > 12 ? +h - 12 : +h || 12) + (+m === 0 ? (+h > 12 || +h === 0 ? '' : " o'clock") : +m < 10 ? ` oh ${enCardinal(+m)}` : ` ${enCardinal(+m)}`)
        + (+h > 12 ? ' PM' : +h === 0 ? ' AM' : ''))
    .replace(/(\d):(?=\d)/g, fr ? '$1 contre ' : '$1 to ');

  if (fr) {
    result = result.replace(/(\d+)(ères?|ers?|res?|ndes?|nds?|èmes?|emes?|es?)(?![\p{L}\p{M}])/gu,
      (match, n: string, suffix: string) => {
        const plural = suffix.endsWith('s') ? 's' : '';
        if (suffix.startsWith('nd')) return +n === 2 ? `second${suffix.startsWith('nde') ? 'e' : ''}${plural}` : match;
        return frOrdinal(+n, /^(?:ère|re)/.test(suffix)) + plural;
      });
  } else {
    result = result
      .replace(/(\d+)(?:st|nd|rd|th)(?![\p{L}\p{M}])/gu, (_, n: string) => enOrdinal(+n))
      .replace(new RegExp(`(?<=\\b(?:${EN_MONTHS})\\s+)(\\d{1,2})(?![\\p{L}\\p{N}]|[.:]\\d)`, 'gu'), (_, n: string) => enOrdinal(+n))
      .replace(/'?(\d*0)s(?![\p{L}\p{M}])/gu, (_, n: string) =>
        (n.length === 4 ? enYear(+n) : enCardinal(+n)).replace(/y$/, 'ie') + 's')
      // ponytail: a bare four-digit number in 1100–2099 is read as a year unless it
      // is money or a percentage; « 2024 people » would be misread.
      .replace(/(?<![\p{L}\p{N}$€£]|[.,]\d*)(\d{4})(?![\p{L}\p{N}]|[.,]\d|\s*(?:%|percent))/gu, (_, n: string) => enYear(+n));
  }

  return result
    .replace(/\d+(?:[.,]\d+)+/g, (chain, offset: number, all: string) => {
      const parts = chain.split(/([.,])/);
      const decimalSeparator = fr ? ',' : '.';
      if (parts.length === 3 && parts[1] === decimalSeparator) {
        const decimals = parts[2]!;
        // English reads decimals digit by digit; French reads short ones as a number.
        const spoken = !fr || decimals.length > 3
          ? decimals.split('').map((d) => cardinal(+d)).join(' ')
          : [...decimals.match(/^0*/)![0]].map(() => 'zéro').concat(/[1-9]/.test(decimals) ? [cardinal(+decimals)] : []).join(' ');
        return pad(`${integer(parts[0]!)} ${fr ? 'virgule' : 'point'} ${spoken}`, all, offset, chain.length);
      }
      return pad(parts.map((part) => part === '.' ? ' point ' : part === ',' ? ', ' : integer(part)).join(''), all, offset, chain.length);
    })
    .replace(/\d+/g, (digits, offset: number, all: string) => pad(integer(digits), all, offset, digits.length))
    .replace(/\b(millions?|milliards?) (euros|dollars|livres)\b/g, (_, scale: string, currency: string) =>
      `${scale} ${currency === 'euros' ? "d'euros" : `de ${currency}`}`);
}
