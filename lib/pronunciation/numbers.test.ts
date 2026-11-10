import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSpokenNumbers, verbalizeNumericForms } from './numbers.ts';

test('normalise milliers, millions et décimales français', () => {
  for (const space of [' ', '\u00a0', '\u202f']) {
    assert.equal(normalizeSpokenNumbers(`40${space}000`, 'fr'), '40000');
    assert.equal(normalizeSpokenNumbers(`1${space}250${space}000`, 'fr-FR'), '1250000');
    assert.equal(normalizeSpokenNumbers(`-40${space}000,50`, 'FR'), '-40000,50');
  }
  assert.equal(normalizeSpokenNumbers('+1 000,007', 'fr'), '+1000,007');
  assert.equal(normalizeSpokenNumbers('Prix : 40 000, puis 50 000 €.', 'fr'), 'Prix : 40000, puis 50000 €.');
});

test('normalise groupements anglais avec virgule ou espace', () => {
  assert.equal(normalizeSpokenNumbers('40,000.50 and 1,250,000', 'en-US'), '40000.50 and 1250000');
  assert.equal(normalizeSpokenNumbers('+40 000.007', 'en'), '+40000.007');
  assert.equal(normalizeSpokenNumbers('-1\u202f250\u00a0000.50', 'en'), '-1250000.50');
});

test('interprète les séparateurs selon la langue', () => {
  assert.equal(normalizeSpokenNumbers('1,234', 'fr'), '1,234');
  assert.equal(normalizeSpokenNumbers('1,234', 'en'), '1234');
  assert.equal(normalizeSpokenNumbers('1.234', 'en'), '1.234');
  assert.equal(normalizeSpokenNumbers('1.234', 'fr'), '1.234');
  assert.equal(normalizeSpokenNumbers('40 000.50', 'fr'), '40 000.50');
  assert.equal(normalizeSpokenNumbers('40 000,50', 'en'), '40 000,50');
});

test('préserve codes à zéro initial, téléphones, versions et groupes invalides', () => {
  const values = [
    '007', '01 000 000', '00 001', '01 23 45 67 89', '+33 1 23 45 67 89',
    '+1 800 555 0100', '1 23 000', '1 000 00', '4000 000', '1,250 000',
    '1.2.003', '192.168.000.001', 'v1 000', 'A40 000', '40 000B', '40_000',
  ];
  for (const lang of ['fr', 'en']) {
    for (const value of values) {
      assert.equal(normalizeSpokenNumbers(value, lang), value, `${lang}: ${value}`);
    }
  }
});

test('ne traverse pas les lignes et ne change pas les autres langues', () => {
  assert.equal(normalizeSpokenNumbers('40\n000', 'fr'), '40\n000');
  assert.equal(normalizeSpokenNumbers('40 000,50 et 1,234', 'de'), '40 000,50 et 1,234');
  assert.equal(normalizeSpokenNumbers('40 000', 'ja'), '40 000');
});

test('respecte les frontières Unicode, y compris caractères astraux et accents décomposés', () => {
  for (const value of ['𐐀40 000', '40 000𐐀', '𝟘40 000', '40 000𝟘', 'e\u030140 000', '40 000\u0301e']) {
    assert.equal(normalizeSpokenNumbers(value, 'fr'), value);
  }
  assert.equal(normalizeSpokenNumbers('𐐀(40 000)', 'fr'), '𐐀(40000)');
});

test('normalisation idempotente', () => {
  for (const lang of ['fr', 'en']) {
    const text = normalizeSpokenNumbers('40 000,50 / 1,234.007 / 007', lang);
    assert.equal(normalizeSpokenNumbers(text, lang), text);
  }
});

test('un séparateur répété est un séparateur de milliers dans les deux langues', () => {
  for (const lang of ['fr', 'en']) {
    assert.equal(normalizeSpokenNumbers('1.000.000', lang), '1000000', lang);
    assert.equal(normalizeSpokenNumbers('1,000,000', lang), '1000000', lang);
  }
  assert.equal(normalizeSpokenNumbers('1.000.000,50', 'fr'), '1000000,50');
  assert.equal(normalizeSpokenNumbers('1,000,000.50', 'fr'), '1000000.50');
  assert.equal(normalizeSpokenNumbers('192.168.100.200', 'fr'), '192.168.100.200');
});

const v = verbalizeNumericForms;

test('verbalise les heures', () => {
  assert.equal(v('à 14:05, 8:00, 0:30', 'fr'), 'à 14 heures 5, 8 heures, 0 heure 30');
  assert.equal(v('14:30:15', 'fr'), '14 heures 30 minutes 15 secondes');
  assert.equal(v('2:05 pm, 2:30pm, 8:00, 14:00, 9:00 a.m.', 'en'), "2 oh 5 PM, 2 30 PM, 8 o'clock, 2 PM, 9 AM.");
  assert.equal(v('14:30, 0:15, 23:05:10', 'en'), '2 30 PM, 12 15 AM, 11 oh 5 and 10 seconds PM');
  for (const value of ['10:1', '24:00', '1.5:30', 'v1:30']) assert.equal(v(value, 'fr'), value, value);
});

test('verbalise les dates', () => {
  assert.equal(v('le 01/02/2024, le 15.03.2024, 2024-03-15', 'fr'), 'le 1er février 2024, le 15 mars 2024, 15 mars 2024');
  assert.equal(v('le 05 mai, le 01 avril, le 15/03, 05/12', 'fr'), 'le 5 mai, le 1er avril, le 15 mars, 5 décembre');
  // English day/month order is ambiguous: numbers only, no month named.
  assert.equal(v('on 01/02/2024 and 2024-03-15, 05 May', 'en'), 'on 1 2 2024 and March 15, 2024, 5 May');
  for (const value of ['32/01/2024', '15/13/2024', '1.2.24', '2024-13-01']) assert.equal(v(value, 'fr'), value, value);
});

test('verbalise barres obliques, fractions et numéros', () => {
  assert.equal(v('100 km/h, 20 €/mois, 24h/24, 7j/7', 'fr'), '100 kilomètres par heure, 20 euros par mois, 24 heures sur 24, 7 jours sur 7');
  assert.equal(v('1/2, 3/4, 2/3 des gens, 15/20, 24/7, 1/2 finale', 'fr'), 'un demi, trois quarts, deux tiers des gens, 15 sur 20, 24 sur 7, demi finale');
  assert.equal(v('1/2, 24/7, 9/10, 50/50, 100 km/h, #1', 'en'), 'one half, 24 7, 9 out of 10, 50 50, 100 kilometers per hour, number 1');
  for (const value of ['et/ou', 'TCP/IP', '2024/2025', 'a/1/2']) assert.equal(v(value, 'fr'), value, value);
});

test('convertit les chiffres romains', () => {
  assert.equal(v('Louis XIV, le XIXe siècle, François Ier, la Ve République, Vatican II', 'fr'), 'Louis 14, le 19e siècle, François 1er, la 5e République, Vatican 2');
  assert.equal(v('Henry VIII, World War II', 'en'), 'Henry 8, World War 2');
  for (const value of ['I', 'V', 'DIX', 'MIX', 'XXL', 'VIVE', 'IIII', 'VX', 'Xe']) assert.equal(v(value, 'en'), value, value);
});

test('verbalise unités carrées et cubes, retire les appels de note', () => {
  assert.equal(v('25 m², 1 m², 1,5 km², 3 m³, prix au m²', 'fr'), '25 mètres carrés, 1 mètre carré, 1,5 kilomètre carré, 3 mètres cubes, prix au mètre carré');
  assert.equal(v('25 m², 1 dm³', 'en'), '25 square meters, 1 cubic decimeter');
  assert.equal(v('une étude¹ citée.² Fin', 'fr'), 'une étude citée. Fin');
  assert.equal(v('E=mc²', 'fr'), 'E=mc²');
});

test('verbalise heures « 14h30 », « 9am », unités et devises', () => {
  assert.equal(v('à 14h30, 9h, 8h00, 4h de route, 9h-18h', 'fr'), 'à 14 heures 30, 9 heures, 8 heures, 4 heures de route, 9 heures à 18 heures');
  assert.equal(v('9am, 9 p.m. sharp, 9 a.m.', 'en'), '9 AM, 9 PM sharp, 9 AM.');
  assert.equal(v('100 km, 1 kg, 1,5 kg, -5°C, 20 €, $20, 1 £', 'fr'), '100 kilomètres, 1 kilogramme, 1,5 kilogramme, -5 degrés Celsius, 20 euros, 20 dollars, 1 livre');
  assert.equal(v('100 km, 1 kg, 30°F, $1, 60 mph', 'en'), '100 kilometers, 1 kilogram, 30 degrees Fahrenheit, 1 dollar, 60 miles per hour');
  for (const value of ['H2O', 'h24', '25h']) assert.equal(v(value, 'fr'), value, value);
});

test('ne verbalise pas les autres langues', () => {
  assert.equal(v('14:05 01/02/2024 XIV 25 m²', 'de'), '14:05 01/02/2024 XIV 25 m²');
});
