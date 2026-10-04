// Money is stored at the precision it's actually paid in: USD to the cent,
// riel to the whole riel (the backend keeps the same, as minor units). Riel
// change handed back is rounded to the smallest note, 100 -- the same rule
// the POS screens use for every riel amount (src/khr.js).
const KHR_STEP = 100;

function roundUsd(amount) {
  const n = Number(amount) || 0;
  // EPSILON so 1.005 rounds to 1.01, not 1.00 (it's 1.00499.. as a double).
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

function roundAmount(amount, currency) {
  return currency === 'KHR' ? Math.round(Number(amount) || 0) : roundUsd(amount);
}

function roundKhrToNote(khr) {
  return Math.round((Number(khr) || 0) / KHR_STEP) * KHR_STEP;
}

module.exports = { roundUsd, roundAmount, roundKhrToNote };
