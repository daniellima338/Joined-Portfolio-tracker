// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDcfFairValue, upsidePct, toNumber, perShareFcf, validateInputs, fairValueFromInputs, sensitivityGrid,
  normalizeTicker, isValidIsoDate, valuationFromInputs, migrateDcfValuations, daysUntil, upcomingReports,
} from '../lib/dcf.js';

const close = (actual, expected, tol = 0.005, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || 'value'}: expected ${expected} +/- ${tol}, got ${actual}`);

// Independent check, written differently from the loop in lib/dcf.js: closed-form value of a
// growing annuity for the projection years plus a discounted Gordon terminal value.
const closedForm = (fcf0, g, n, tg, r) => {
  const fcf1 = fcf0 * (1 + g);
  const annuity = g === r ? (n * fcf1) / (1 + r) : (fcf1 / (r - g)) * (1 - Math.pow((1 + g) / (1 + r), n));
  const terminal = ((fcf0 * Math.pow(1 + g, n) * (1 + tg)) / (r - tg)) / Math.pow(1 + r, n);
  return annuity + terminal;
};

const base = {
  fcfBasis: 'perShare', startingFcf: '1.00', growthRate: '4', years: '5',
  terminalGrowth: '2', discountRate: '8.5', sellPremiumPct: '20',
};

test('matches the closed-form value across a spread of inputs', () => {
  for (const [f, g, n, tg, r] of [
    [1, 0.04, 5, 0.02, 0.085], [5, 0.1, 5, 0.025, 0.09], [2.5, -0.03, 7, 0.01, 0.07],
    [10, 0.0, 3, 0.0, 0.05], [0.8, 0.25, 10, 0.03, 0.12], [3, 0.06, 1, 0.02, 0.2],
  ]) {
    const got = computeDcfFairValue(f, g, n, tg, r).fairValue;
    close(got, closedForm(f, g, n, tg, r), 1e-9, `inputs ${[f, g, n, tg, r]}`);
  }
});

test('growth equal to the discount rate does not break the maths', () => {
  const got = computeDcfFairValue(2, 0.08, 4, 0.02, 0.08).fairValue;
  close(got, closedForm(2, 0.08, 4, 0.02, 0.08), 1e-9);
});

test('golden values quoted in the Alm. Brand analysis', () => {
  const v = (f, g, r) => computeDcfFairValue(f, g, 5, 0.02, r).fairValue;
  close(v(1.0, 0.04, 0.085), 17.11, 0.005, 'base');
  close(v(0.94, 0.04, 0.085), 16.08, 0.005, 'start 0.94');
  close(v(0.81, 0.04, 0.085), 13.86, 0.005, 'start 0.81');
  close(v(1.0, 0.02, 0.085), 15.69, 0.005, 'growth 2%');
  close(v(1.0, 0.06, 0.085), 18.63, 0.005, 'growth 6%');
  close(v(1.0, 0.04, 0.075), 20.25, 0.005, 'discount 7.5%');
  close(v(1.0, 0.04, 0.095), 14.81, 0.005, 'discount 9.5%');
});

test('projection rows: one per year, growing, present values add up', () => {
  const r = computeDcfFairValue(1, 0.04, 5, 0.02, 0.085);
  assert.equal(r.rows.length, 5);
  close(r.rows[0].fcf, 1.04, 1e-12);
  close(r.rows[4].fcf, Math.pow(1.04, 5), 1e-12);
  close(r.rows.reduce((s, x) => s + x.pv, 0), r.pvSum, 1e-12);
  close(r.pvSum + r.pvTerminal, r.fairValue, 1e-12);
});

test('invalid inputs give null, never NaN or Infinity', () => {
  assert.equal(computeDcfFairValue(0, 0.04, 5, 0.02, 0.085), null);
  assert.equal(computeDcfFairValue(-1, 0.04, 5, 0.02, 0.085), null);
  assert.equal(computeDcfFairValue(1, 0.04, 0, 0.02, 0.085), null);
  assert.equal(computeDcfFairValue(1, 0.04, 5, 0.02, 0.02), null); // discount == terminal
  assert.equal(computeDcfFairValue(1, 0.04, 5, 0.03, 0.02), null); // discount < terminal
  assert.equal(computeDcfFairValue(NaN, 0.04, 5, 0.02, 0.085), null);
  assert.equal(computeDcfFairValue(1, NaN, 5, 0.02, 0.085), null);
  assert.equal(computeDcfFairValue(1, 0.04, 5, 0.02, Infinity), null);
  assert.equal(computeDcfFairValue('1', 0.04, 5, 0.02, 0.085), null); // low level takes numbers only
});

test('upsidePct is fair value against price, as a percentage of price', () => {
  close(upsidePct(110, 100), 10, 1e-12);
  close(upsidePct(90, 100), -10, 1e-12);
  assert.equal(upsidePct(100, 0), null);
  assert.equal(upsidePct(NaN, 100), null);
  assert.equal(upsidePct(100, undefined), null);
});

test('toNumber accepts numbers and numeric strings, nothing else', () => {
  assert.equal(toNumber(4), 4);
  assert.equal(toNumber(' 4.5 '), 4.5);
  assert.equal(toNumber('4,5'), 4.5);
  assert.ok(Number.isNaN(toNumber('')));
  assert.ok(Number.isNaN(toNumber(null)));
  assert.ok(Number.isNaN(toNumber(undefined)));
  assert.ok(Number.isNaN(toNumber('abc')));
  assert.ok(Number.isNaN(toNumber(NaN)));
});

test('perShareFcf: per-share passes through, total divides by shares', () => {
  assert.equal(perShareFcf({ fcfBasis: 'perShare', startingFcf: '5' }), 5);
  assert.equal(perShareFcf({ startingFcf: 5 }), 5); // basis defaults to per share
  assert.equal(perShareFcf({ fcfBasis: 'total', startingFcf: '1400', sharesOutstanding: '1420' }), 1400 / 1420);
  assert.equal(perShareFcf({ fcfBasis: 'total', startingFcf: 1400, sharesOutstanding: 0 }), null);
  assert.equal(perShareFcf({ fcfBasis: 'total', startingFcf: 1400 }), null);
  assert.equal(perShareFcf({ startingFcf: 'x' }), null);
  assert.equal(perShareFcf(null), null);
});

test('validateInputs lists what is wrong', () => {
  assert.deepEqual(validateInputs(base), []);
  assert.ok(validateInputs({ ...base, startingFcf: '' }).length > 0);
  assert.ok(validateInputs({ ...base, startingFcf: '-2' }).length > 0);
  assert.ok(validateInputs({ ...base, years: '0' }).length > 0);
  assert.ok(validateInputs({ ...base, discountRate: '2', terminalGrowth: '2' }).length > 0);
  assert.ok(validateInputs({ ...base, discountRate: '' }).length > 0);
  assert.ok(validateInputs({ ...base, fcfBasis: 'total', sharesOutstanding: '' }).length > 0);
  assert.deepEqual(validateInputs({ ...base, fcfBasis: 'total', startingFcf: '1400', sharesOutstanding: '1420' }), []);
  assert.deepEqual(validateInputs(undefined), ['No inputs.']);
});

test('fairValueFromInputs: strings, percentages and the sell price', () => {
  const r = fairValueFromInputs(base);
  close(r.fairValue, 17.11, 0.005);
  close(r.sellPrice, r.fairValue * 1.2, 1e-9);
  assert.equal(r.sellPremiumPct, 20);
  assert.equal(r.perShareFcf, 1);
  assert.equal(r.rows.length, 5);
  // no premium given: sell price equals fair value
  const noPremium = fairValueFromInputs({ ...base, sellPremiumPct: undefined });
  close(noPremium.sellPrice, noPremium.fairValue, 1e-12);
  assert.equal(noPremium.sellPremiumPct, 0);
  assert.equal(fairValueFromInputs({ ...base, startingFcf: '' }), null);
});

test('total FCF over shares gives the same fair value as the equivalent per-share figure', () => {
  const perShare = fairValueFromInputs({ ...base, startingFcf: '1' });
  const total = fairValueFromInputs({ ...base, fcfBasis: 'total', startingFcf: '1420', sharesOutstanding: '1420' });
  close(total.fairValue, perShare.fairValue, 1e-9);
});

test('net debt lowers fair value per share, net cash raises it; ignored for per-share basis', () => {
  const total = { ...base, fcfBasis: 'total', startingFcf: '1000', sharesOutstanding: '500' };
  const none = fairValueFromInputs(total);
  const debt = fairValueFromInputs({ ...total, netDebt: '250' });
  const cash = fairValueFromInputs({ ...total, netDebt: '-250' });
  close(debt.fairValue, none.fairValue - 0.5, 1e-9);
  close(cash.fairValue, none.fairValue + 0.5, 1e-9);
  const perShareWithDebt = fairValueFromInputs({ ...base, netDebt: '999' });
  close(perShareWithDebt.fairValue, fairValueFromInputs(base).fairValue, 1e-12);
});

test('a net debt larger than the value gives a non-positive fair value and no sell price', () => {
  const r = fairValueFromInputs({ ...base, fcfBasis: 'total', startingFcf: '10', sharesOutstanding: '10', netDebt: '1000' });
  assert.ok(r.fairValue < 0);
  assert.equal(r.sellPrice, null);
});

test('sensitivityGrid: 5x5, centre equals the base value, falls as the discount rate rises', () => {
  const s = sensitivityGrid(base);
  assert.equal(s.grid.length, 5);
  assert.ok(s.grid.every((row) => row.length === 5));
  assert.deepEqual(s.discountSteps, [7.5, 8, 8.5, 9, 9.5]);
  assert.deepEqual(s.terminalSteps, [1, 1.5, 2, 2.5, 3]);
  close(s.grid[2][2], fairValueFromInputs(base).fairValue, 1e-9);
  for (let c = 0; c < 5; c++) for (let r = 1; r < 5; r++) assert.ok(s.grid[r][c] < s.grid[r - 1][c]);
  for (let r = 0; r < 5; r++) for (let c = 1; c < 5; c++) assert.ok(s.grid[r][c] > s.grid[r][c - 1]);
});

test('sensitivityGrid: cells where discount is not above terminal growth are null', () => {
  const s = sensitivityGrid({ ...base, discountRate: '3', terminalGrowth: '2.5' });
  assert.equal(s.grid[0][4], null); // 2% discount vs 3.5% terminal
  assert.ok(s.grid[4][0] > 0);
  assert.equal(sensitivityGrid({ ...base, startingFcf: '' }), null);
});

test('deterministic and does not modify its inputs', () => {
  const copy = JSON.parse(JSON.stringify(base));
  const a = fairValueFromInputs(base);
  const b = fairValueFromInputs(base);
  assert.deepEqual(a, b);
  assert.deepEqual(base, copy);
  sensitivityGrid(base);
  assert.deepEqual(base, copy);
});

test('normalizeTicker and isValidIsoDate', () => {
  assert.equal(normalizeTicker(' almb.co '), 'ALMB.CO');
  assert.equal(normalizeTicker(null), '');
  assert.ok(isValidIsoDate('2026-10-28'));
  assert.ok(isValidIsoDate('2028-02-29'));
  assert.ok(!isValidIsoDate('2026-02-30'));
  assert.ok(!isValidIsoDate('2026-13-01'));
  assert.ok(!isValidIsoDate('28/10/2026'));
  assert.ok(!isValidIsoDate(''));
  assert.ok(!isValidIsoDate(undefined));
});

test('valuationFromInputs gives display fields, or null without a valid valuation', () => {
  const v = valuationFromInputs({ ...base, ticker: 'almb.co', company: 'Alm. Brand', currency: 'DKK', priceAtAnalysis: 17.76, updatedAt: '2026-10-13', note: 'n' });
  assert.equal(v.ticker, 'ALMB.CO');
  assert.equal(v.currency, 'DKK');
  close(v.fairValue, 17.11, 0.005);
  close(v.sellPrice, v.fairValue * 1.2, 1e-9);
  assert.equal(v.priceAtAnalysis, 17.76);
  assert.equal(v.savedAt, '2026-10-13');
  assert.equal(valuationFromInputs({ ticker: 'X', nextReportDate: '2026-11-01' }), null); // report date only
  assert.equal(valuationFromInputs({ ...base, ticker: 'X', startingFcf: '' }), null);
  assert.equal(valuationFromInputs({ ...base, ticker: 'X', fcfBasis: 'total', startingFcf: '10', sharesOutstanding: '10', netDebt: '1000' }), null); // value below zero
});

test('migrateDcfValuations converts old entries and the recomputed fair value matches the stored one', () => {
  const old = {
    'ALMB.CO': {
      ticker: 'ALMB.CO', company: 'Alm. Brand', currency: 'DKK', fairValue: 17.11, sellPremiumPct: 20, sellPrice: 20.53,
      priceAtAnalysis: 17.76, startingFcf: 1, growthRate: 4, years: 5, terminalGrowth: 2, discountRate: 8.5,
      note: 'first pass', savedAt: '2026-10-13',
    },
    AAPL: {
      ticker: 'AAPL', company: 'Apple Inc.', currency: 'USD', fairValue: 119.06, sellPremiumPct: 20, sellPrice: 142.88,
      priceAtAnalysis: 150, startingFcf: 6.5, growthRate: 6, years: 5, terminalGrowth: 2.5, discountRate: 9,
      note: '', savedAt: '2026-10-13',
    },
  };
  const copy = JSON.parse(JSON.stringify(old));
  const { inputs, report } = migrateDcfValuations(old);
  assert.deepEqual(old, copy); // input untouched
  assert.equal(report.count, 2);
  assert.deepEqual(report.mismatches, []);
  const a = inputs['ALMB.CO'];
  assert.equal(a.fcfBasis, 'perShare');
  assert.equal(a.currency, 'DKK');
  assert.equal(a.startingFcf, 1);
  assert.equal(a.sellPremiumPct, 20);
  assert.equal(a.nextReportDate, '');
  assert.equal(a.updatedAt, '2026-10-13');
  assert.equal(a.note, 'first pass');
  close(fairValueFromInputs(a).fairValue, 17.11, 0.005);
});

test('migrateDcfValuations reports a mismatch and skips entries without a ticker; empty input is fine', () => {
  const { inputs, report } = migrateDcfValuations({
    X: { ticker: 'x', company: 'X', currency: 'USD', fairValue: 99, startingFcf: 1, growthRate: 4, years: 5, terminalGrowth: 2, discountRate: 8.5 },
    bad: { company: 'No ticker', fairValue: 1 },
  });
  assert.equal(report.count, 1);
  assert.equal(report.skipped, 1);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].ticker, 'X');
  assert.ok(inputs.X);
  assert.deepEqual(migrateDcfValuations(undefined).inputs, {});
  assert.deepEqual(migrateDcfValuations({}).report, { count: 0, mismatches: [], skipped: 0 });
});

test('daysUntil counts whole calendar days, including across month ends and leap days', () => {
  assert.equal(daysUntil('2026-10-28', '2026-10-18'), 10);
  assert.equal(daysUntil('2026-10-18', '2026-10-18'), 0);
  assert.equal(daysUntil('2026-10-17', '2026-10-18'), -1);
  assert.equal(daysUntil('2026-11-02', '2026-10-30'), 3);
  assert.equal(daysUntil('2028-03-01', '2028-02-28'), 2); // 2028 is a leap year
  assert.equal(daysUntil('2027-03-01', '2027-02-28'), 1);
  assert.equal(daysUntil('2027-01-01', '2026-01-01'), 365);
  assert.equal(daysUntil('', '2026-10-18'), null);
  assert.equal(daysUntil('2026-02-30', '2026-10-18'), null);
  assert.equal(daysUntil('2026-10-18', undefined), null);
});

test('upcomingReports: held tickers only, soonest first, past ones last, invalid dates left out', () => {
  const inputs = {
    AAA: { company: 'Alpha', nextReportDate: '2026-11-05' },
    BBB: { company: 'Beta', nextReportDate: '2026-10-20' },
    CCC: { company: 'Gamma', nextReportDate: '2026-09-30' }, // past
    DDD: { company: 'Delta', nextReportDate: '2026-10-18' }, // today counts as upcoming
    EEE: { company: 'Epsilon', nextReportDate: '2026-08-01' }, // past, older
    FFF: { company: 'Zeta', nextReportDate: '' },
    GGG: { company: 'Not held', nextReportDate: '2026-10-19' },
    HHH: { company: 'Eta', nextReportDate: 'soon' },
    III: { company: 'Iota', nextReportDate: '2026-10-20' }, // same day as BBB: ticker order
  };
  const held = ['aaa', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'HHH', 'III', 'III', 'NOPE'];
  const rows = upcomingReports(inputs, held, '2026-10-18');
  assert.deepEqual(rows.map((r) => r.ticker), ['DDD', 'BBB', 'III', 'AAA', 'CCC', 'EEE']);
  assert.deepEqual(rows.map((r) => r.daysUntil), [0, 2, 2, 18, -18, -78]);
  assert.deepEqual(rows.map((r) => r.isPast), [false, false, false, false, true, true]);
  assert.equal(rows[0].company, 'Delta');
  assert.deepEqual(upcomingReports(undefined, ['A'], '2026-10-18'), []);
  assert.deepEqual(upcomingReports(inputs, undefined, '2026-10-18'), []);
  assert.deepEqual(upcomingReports(inputs, held, 'bad'), []);
});
