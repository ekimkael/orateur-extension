import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSpokenNumbers } from './numbers.ts';

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
