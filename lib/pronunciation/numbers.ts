const NUMERIC_SPAN = /[+-]?\d+(?:[ \u00a0\u202f]+\d+|[,.]\d+)*/g;
const WORD_BEFORE = /[\p{L}\p{M}\p{N}_]$/u;
const WORD_AFTER = /^[\p{L}\p{M}\p{N}_]/u;
const GROUPED_FRENCH = /^[+-]?[1-9]\d{0,2}(?:[ \u00a0\u202f]+\d{3})+(?:,\d+)?$/;
const GROUPED_ENGLISH = /^[+-]?[1-9]\d{0,2}(?:(?:,\d{3})+|(?:[ \u00a0\u202f]+\d{3})+)(?:\.\d+)?$/;
const REPEATED_DOTS = /^[+-]?[1-9]\d{0,2}(?:\.\d{3}){2,}(?:,\d+)?$/;
const REPEATED_COMMAS = /^[+-]?[1-9]\d{0,2}(?:,\d{3}){2,}(?:\.\d+)?$/;

/** Remove thousands separators for speech; displayed text stays untouched. */
export function normalizeSpokenNumbers(text: string, language: string): string {
  const lang = language.slice(0, 2).toLowerCase();
  if (lang !== 'fr' && lang !== 'en') return text;

  return text.replace(NUMERIC_SPAN, (number, offset: number) => {
    // Match the entire numeric span so malformed groups, telephone numbers,
    // versions and zero-prefixed codes cannot have only a suffix rewritten.
    if (WORD_BEFORE.test(text.slice(Math.max(0, offset - 2), offset)) ||
        WORD_AFTER.test(text.slice(offset + number.length, offset + number.length + 2))) return number;
    // A separator repeated in 3-digit groups (« 1.000.000 », « 1,000,000 ») can
    // only be a thousands separator, whatever the language. Four groups of at
    // most 255 are left alone: that is an IP address.
    if (REPEATED_DOTS.test(number) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(number.replace(/\d+/g, (g) => (+g > 255 ? 'x' : g)))) {
      return number.replace(/\./g, '');
    }
    if (REPEATED_COMMAS.test(number)) return number.replace(/,/g, '');
    const grouped = lang === 'fr' ? GROUPED_FRENCH : GROUPED_ENGLISH;
    if (!grouped.test(number)) return number;
    return number.replace(lang === 'fr' ? /[ \u00a0\u202f]/g : /[, \u00a0\u202f]/g, '');
  });
}

const BEFORE = '(?<![\\p{L}\\p{M}\\p{N}_]|\\d[.,:/-])';
const AFTER = '(?![\\p{L}\\p{M}\\p{N}_]|[.,:/-]\\d)';

const MONTHS: Record<string, string[]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const FRACTIONS: Record<string, Record<string, string>> = {
  fr: { '1/2': 'un demi', '1/3': 'un tiers', '2/3': 'deux tiers', '1/4': 'un quart', '3/4': 'trois quarts', '50/50': '50 50' },
  en: { '1/2': 'one half', '1/3': 'one third', '2/3': 'two thirds', '1/4': 'one quarter', '3/4': 'three quarters', '24/7': '24 7', '50/50': '50 50' },
};

const PER_UNIT: Record<string, Record<string, string>> = {
  fr: { h: 'heure', min: 'minute', mn: 'minute', s: 'seconde', j: 'jour' },
  en: { h: 'hour', min: 'minute', s: 'second', d: 'day' },
};

const UNITS: Record<string, Record<string, [string, string]>> = {
  fr: {
    km: ['kilomètre', 'kilomètres'], cm: ['centimètre', 'centimètres'], mm: ['millimètre', 'millimètres'],
    kg: ['kilogramme', 'kilogrammes'], '°C': ['degré Celsius', 'degrés Celsius'], '°F': ['degré Fahrenheit', 'degrés Fahrenheit'],
    '°': ['degré', 'degrés'], '€': ['euro', 'euros'], '£': ['livre', 'livres'], $: ['dollar', 'dollars'], mph: ['mile par heure', 'miles par heure'],
  },
  en: {
    km: ['kilometer', 'kilometers'], cm: ['centimeter', 'centimeters'], mm: ['millimeter', 'millimeters'],
    kg: ['kilogram', 'kilograms'], '°C': ['degree Celsius', 'degrees Celsius'], '°F': ['degree Fahrenheit', 'degrees Fahrenheit'],
    '°': ['degree', 'degrees'], '€': ['euro', 'euros'], '£': ['pound', 'pounds'], $: ['dollar', 'dollars'], mph: ['mile per hour', 'miles per hour'],
  },
};

const METRIC_PREFIX:Record<string, string> = { k: 'kilo', c: 'centi', d: 'déci', m: 'milli' };

const isDay = (d: string) => +d >= 1 && +d <= 31;
const isMonth = (m: string) => +m >= 1 && +m <= 12;

function romanValue(roman: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const value = values[roman[i]!]!;
    total += value < (values[roman[i + 1]!] ?? 0) ? -value : value;
  }
  return total;
}

/**
 * Spells out the numeric forms a voice misreads or the Supertonic preprocessing
 * mangles (it drops `/` and NFKD turns `²` into `2`): times, dates, slashes,
 * Roman numerals, squared and cubed units, footnote markers. Runs before
 * acronym spelling and capital lowering, which would otherwise wreck `XIV`.
 */
export function verbalizeNumericForms(text: string, language: string): string {
  const lang = language.slice(0, 2).toLowerCase();
  if (lang !== 'fr' && lang !== 'en') return text;
  const fr = lang === 'fr';
  const months = MONTHS[lang]!;
  // French days need « 1er », which the VERBALIZE layer then reads « premier ».
  const day = (d: string) => (fr && +d === 1 ? '1er' : String(+d));
  const frDate = (d: string, m: string, y = '') => `${day(d)} ${months[+m - 1]}${y && ` ${y}`}`;
  const monthNames = months.join('|');

  return text
    // Squared and cubed metric units, before NFKD turns « m² » into « m2 ».
    .replace(/(?:(\d+(?:[.,]\d+)?)\s*)?(?<![\p{L}\p{M}])([kcdm]?)m([²³])(?![\p{L}\p{M}\p{N}])/gu,
      (_, n: string | undefined, prefix: string, power: string) => {
        const value = n ? +n.replace(',', '.') : 1;
        const s = (fr ? value >= 2 : value !== 1) ? 's' : '';
        const unit = (METRIC_PREFIX[prefix] ?? '') + (fr ? 'mètre' : 'meter');
        const spoken = fr
          ? `${unit}${s} ${power === '²' ? 'carré' : 'cube'}${s}`
          : `${power === '²' ? 'square' : 'cubic'} ${unit.replace('déci', 'deci')}${s}`;
        return n ? `${n} ${spoken}` : spoken;
      })
    // ponytail: footnote markers glued to a word or punctuation are dropped;
    // a short formula like « mc² » keeps its exponent.
    .replace(/(?<=\p{L}{3}|[.,;:!?)»"'’])[¹²³⁰⁴-⁹]+/gu, '')
    .replace(/(?<![\p{L}\p{M}\p{N}_])([IVX]+)(?=(e|er|re|ème)?(?![\p{L}\p{M}\p{N}_]))/gu,
      (match, roman: string, suffix: string | undefined) => {
        // A lone letter is a numeral only with a French ordinal suffix (« Ier », « Ve »).
        if (roman.length < 2 && !(fr && suffix)) return match;
        if (!/^X{0,3}(IX|IV|V?I{0,3})$/.test(roman)) return match;
        return String(romanValue(roman));
      })
    // ISO dates are unambiguous in both languages.
    .replace(new RegExp(`${BEFORE}(\\d{4})-(\\d{1,2})-(\\d{1,2})${AFTER}`, 'gu'), (match, y: string, m: string, d: string) => {
      if (!isMonth(m) || !isDay(d)) return match;
      return fr ? frDate(d, m, y) : `${months[+m - 1]} ${+d}, ${y}`;
    })
    // Day/month/year: French order is certain; English could be either, so the
    // numbers are read without leading zeros and no month is named.
    .replace(new RegExp(`${BEFORE}(\\d{1,2})([/.])(\\d{1,2})\\2(\\d{4}|\\d{2})${AFTER}`, 'gu'),
      (match, a: string, sep: string, b: string, y: string) => {
        if ((sep === '.' && y.length !== 4) || !isDay(a) || !isDay(b)) return match;
        if (fr) return isMonth(b) ? frDate(a, b, y) : match;
        return `${+a} ${+b} ${y}`;
      })
    .replace(new RegExp(`${BEFORE}0?(\\d{1,2})(?=\\s+(?:${monthNames})(?![\\p{L}\\p{M}]))`, 'giu'),
      (match, d: string) => (isDay(d) ? day(d) : match))
    .replace(new RegExp(`${BEFORE}(\\d{1,2}):([0-5]\\d)(?::([0-5]\\d))?(?:\\s*([AaPp])\\.?[Mm](?:\\.(?=\\s+\\p{Ll}))?(?![\\p{L}\\p{M}]))?${AFTER}`, 'gu'),
      (match, h: string, m: string, s: string | undefined, meridiem: string | undefined) => {
        if (+h > 23) return match;
        const ampm = meridiem ? ` ${meridiem.toUpperCase()}M` : '';
        if (fr) {
          const parts = [`${+h} heure${+h > 1 ? 's' : ''}`];
          if (+m) parts.push(s ? `${+m} minute${+m > 1 ? 's' : ''}` : String(+m));
          if (s && +s) parts.push(`${+s} seconde${+s > 1 ? 's' : ''}`);
          return parts.join(' ') + ampm;
        }
        // English listeners expect the 12-hour clock: « 14:00 » is « 2 PM », not « fourteen hundred ».
        const twelveHour = !meridiem && (+h > 12 || +h === 0);
        const hour = twelveHour ? (+h === 0 ? 12 : +h - 12) : +h;
        const suffix = twelveHour ? (+h === 0 ? ' AM' : ' PM') : ampm;
        const minutes = +m === 0 ? (suffix ? '' : " o'clock") : +m < 10 ? ` oh ${+m}` : ` ${+m}`;
        return `${hour}${minutes}${s && +s ? ` and ${+s} seconds` : ''}${suffix}`;
      })
    // French « 14h30 », « 9 h », « 8h00 »; a range « 9h-18h » reads « à ».
    .replace(new RegExp(`${BEFORE}(\\d{1,2})\\s?h\\s?([0-5]\\d)?(?![\\p{L}\\p{M}\\p{N}_/])`, 'gu'), (match, h: string, m: string | undefined) =>
      !fr || +h > 23 ? match : `${+h} heure${+h > 1 ? 's' : ''}${m && +m ? ` ${+m}` : ''}`)
    .replace(/(heures?)\s*-\s*(?=\d)/g, '$1 à ')
    // English « 9am », « 9 p.m. ».
    .replace(new RegExp(`${BEFORE}(\\d{1,2})\\s?([AaPp])\\.?[Mm](?:\\.(?=\\s+\\p{Ll}))?(?![\\p{L}\\p{M}])`, 'gu'), (match, h: string, meridiem: string) =>
      +h > 12 ? match : `${+h} ${meridiem.toUpperCase()}M`)
    // « 24h/24 », « 7j/7 ».
    .replace(/(\d+)\s*([hj])\/(\d+)(?![\p{L}\p{N}])/gu, (match, a: string, unit: string, b: string) =>
      fr ? `${a} ${unit === 'h' ? 'heures' : 'jours'} sur ${b}` : match)
    // « 100 km/h », « 20 €/mois ».
    .replace(/(\d\s*[\p{L}€$£]{1,4})\/(\p{L}{1,5})(?![\p{L}\p{M}\p{N}])/gu, (_, quantity: string, unit: string) =>
      `${quantity} ${fr ? 'par' : 'per'} ${PER_UNIT[lang]![unit] ?? unit}`)
    .replace(/(?<![\p{L}\p{N}&])#(?=\d)/gu, fr ? 'numéro ' : 'number ')
    // Currency before the amount (« $20 ») moves after it, then unit symbols are spelled.
    .replace(/([$€£])\s?(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/gu, '$2 $1')
    .replace(/(\d+(?:[.,]\d+)?)\s*(km|cm|mm|kg|°C|°F|°|€|£|\$|mph)(?![\p{L}\p{M}\p{N}])/gu, (_, n: string, symbol: string) => {
      const value = +n.replace(',', '.');
      const [singular, plural] = UNITS[lang]![symbol]!;
      return `${n} ${(fr ? value >= 2 : value !== 1) ? plural : singular}`;
    })
    .replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_/.,])(\\d{1,2})/(\\d{1,2})${AFTER}`, 'gu'), (match, a: string, b: string, offset: number, all: string) => {
      // A zero-padded part (« 15/03 ») or a French « le 15/03 » is a date, not a fraction.
      const dated = /^0/.test(a + ' ' + b) || / 0/.test(` ${a} ${b}`) || (fr && /\b(?:le|du|au)\s+$/i.test(all.slice(0, offset)));
      if (dated && isDay(a) && isMonth(b)) return fr ? frDate(a, b) : `${+a} ${+b}`;
      if (fr && a === '1' && b === '2' && /^\s*finale/i.test(all.slice(offset + match.length))) return 'demi';
      return FRACTIONS[lang]![`${a}/${b}`] ?? (fr ? `${a} sur ${b}` : `${a} out of ${b}`);
    });
}
