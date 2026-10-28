import assert from 'node:assert/strict';
import test from 'node:test';
import { enCardinal, frCardinal, spellNumbers } from './number-words.ts';

test('cardinaux français : et-un, soixante-dix, quatre-vingts, cents, mille', () => {
  const cases: [number, string][] = [
    [0, 'zéro'], [17, 'dix-sept'], [21, 'vingt et un'], [71, 'soixante et onze'], [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'], [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [200, 'deux cents'],
    [201, 'deux cent un'], [1980, 'mille neuf cent quatre-vingts'], [80000, 'quatre-vingt mille'],
    [2300000, 'deux millions trois cent mille'], [80000000, 'quatre-vingts millions'], [1e9, 'un milliard'],
  ];
  for (const [n, words] of cases) assert.equal(frCardinal(n), words, String(n));
});

test('cardinaux anglais', () => {
  assert.equal(enCardinal(0), 'zero');
  assert.equal(enCardinal(101), 'one hundred one');
  assert.equal(enCardinal(2300042), 'two million three hundred thousand forty-two');
});

test('épelle ordinaux, décimales, signes et nombres collés en français', () => {
  assert.equal(spellNumbers('le 19e siècle, la 1re, les 3es, la 2nde, 21e, 80e, 5e, 9e', 'fr'),
    'le dix-neuvième siècle, la première, les troisièmes, la seconde, vingt et unième, quatre-vingtième, cinquième, neuvième');
  assert.equal(spellNumbers('3,5 pourcent, 1,05, 3,14159, v1.2.3', 'fr'),
    'trois virgule cinq pourcent, un virgule zéro cinq, trois virgule un quatre un cinq neuf, v un point deux point trois');
  assert.equal(spellNumbers('G7, 3D, -5, +33, 50-60 ans, 10:1', 'fr'),
    'G sept, trois D, moins cinq, plus trente-trois, cinquante - soixante ans, dix contre un');
  assert.equal(spellNumbers('1000000 euros, 2000000000 dollars', 'fr'), "un million d'euros, deux milliards de dollars");
});

test('épelle ordinaux, années et décennies en anglais', () => {
  assert.equal(spellNumbers('the 21st, 22nd, 3rd, 12th, 20th, March 15, 2024', 'en'),
    'the twenty-first, twenty-second, third, twelfth, twentieth, March fifteenth, twenty twenty-four');
  assert.equal(spellNumbers('in 1999, 2005, 1905, the 1990s, the 90s', 'en'),
    'in nineteen ninety-nine, two thousand five, nineteen oh five, the nineteen nineties, the nineties');
  assert.equal(spellNumbers('$2024, 2024 percent, 3.14, 12345', 'en'),
    '$two thousand twenty-four, two thousand twenty-four percent, three point one four, twelve thousand three hundred forty-five');
});

test('laisse les autres langues intactes', () => {
  assert.equal(spellNumbers('19e 3,5 2024', 'de'), '19e 3,5 2024');
});
