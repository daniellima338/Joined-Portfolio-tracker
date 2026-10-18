// Pure DCF (discounted cash flow) maths for Commingled. No React, no network, no
// storage, no dates, no AI: the same inputs always give the same output, and nothing
// passed in is modified. Imported by pages/index.js and by tests/dcf.test.mjs; an
// agent that updates saved inputs can import it too and check its own numbers.
//
// Two layers:
//   computeDcfFairValue  low level: per-share cash flow and rates as decimals (0.04 = 4%)
//   fairValueFromInputs  what the app stores: rates as percentages (4 = 4%), strings allowed
//
// A valuation is an estimate that depends entirely on the assumptions fed in.

// ---------------------------------------------------------------------------
// Low level
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Standard 2-stage DCF on one cash-flow figure: it grows at `growthRate` for
// `years`, then a Gordon-growth terminal value at `terminalGrowth`, everything
// discounted at `discountRate`. Returns null for inputs that don't produce a sane
// result (non-numbers, non-positive starting cash flow, no projection years, or a
// discount rate at or below terminal growth, which makes the perpetuity diverge).
export const computeDcfFairValue = (fcf0, growthRate, years, terminalGrowth, discountRate) => {
  if (![fcf0, growthRate, years, terminalGrowth, discountRate].every(isNum)) return null;
  if (fcf0 <= 0 || years <= 0 || discountRate <= terminalGrowth) return null;
  const rows = [];
  let fcf = fcf0;
  let pvSum = 0;
  for (let t = 1; t <= years; t++) {
    fcf = fcf * (1 + growthRate);
    const pv = fcf / Math.pow(1 + discountRate, t);
    pvSum += pv;
    rows.push({ year: t, fcf, pv });
  }
  const terminalValue = (fcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + discountRate, years);
  return { rows, pvSum, terminalValue, pvTerminal, fairValue: pvSum + pvTerminal };
};

// Fair value vs price as a percentage of price: +10 means the estimate is 10% above the price.
export const upsidePct = (fairValue, price) => {
  if (!isNum(fairValue) || !isNum(price) || price <= 0) return null;
  return ((fairValue - price) / price) * 100;
};

// ---------------------------------------------------------------------------
// Stored inputs
// ---------------------------------------------------------------------------
//
// Shape of one entry in the saved `dcfInputs` map (all optional except what the maths needs):
//   fcfBasis         'perShare' | 'total'. perShare: startingFcf is already per share.
//                    total: startingFcf is the company's total, divided by sharesOutstanding.
//   startingFcf      number (or numeric string). Same currency as `currency`.
//   sharesOutstanding  number, same scale as total startingFcf (e.g. both in millions). Needed for 'total'.
//   netDebt          number, same scale as total startingFcf. Positive = debt, negative = net cash.
//                    Only used with fcfBasis 'total' (cash flow before debt holders): subtracted from
//                    the value before dividing by shares. Leave empty for per-share equity cash flow.
//   growthRate, terminalGrowth, discountRate   percentages (4 = 4%)
//   years            projection years
//   sellPremiumPct   sell price = fair value x (1 + sellPremiumPct / 100)

// Parses numbers or numeric strings ("1,5" is accepted); anything else gives NaN.
export const toNumber = (v) => {
  if (isNum(v)) return v;
  if (typeof v !== 'string' || v.trim() === '') return NaN;
  return parseFloat(v.trim().replace(',', '.'));
};

// Starting cash flow per share from the stored basis. Returns null if it cannot be worked out.
export const perShareFcf = (inputs) => {
  if (!inputs) return null;
  const fcf = toNumber(inputs.startingFcf);
  if (!isNum(fcf)) return null;
  if (inputs.fcfBasis === 'total') {
    const shares = toNumber(inputs.sharesOutstanding);
    if (!isNum(shares) || shares <= 0) return null;
    return fcf / shares;
  }
  return fcf;
};

// Human-readable problems with a set of inputs, empty when the valuation can be calculated.
export const validateInputs = (inputs) => {
  const problems = [];
  if (!inputs) return ['No inputs.'];
  const fcf = toNumber(inputs.startingFcf);
  if (!isNum(fcf) || fcf <= 0) problems.push('Starting free cash flow must be a positive number.');
  if (inputs.fcfBasis === 'total') {
    const shares = toNumber(inputs.sharesOutstanding);
    if (!isNum(shares) || shares <= 0) problems.push('Shares outstanding must be a positive number when using total free cash flow.');
  }
  const years = toNumber(inputs.years);
  if (!isNum(years) || years < 1) problems.push('Projection years must be at least 1.');
  const g = toNumber(inputs.growthRate);
  const tg = toNumber(inputs.terminalGrowth);
  const r = toNumber(inputs.discountRate);
  if (!isNum(g)) problems.push('Growth rate is missing.');
  if (!isNum(tg)) problems.push('Terminal growth rate is missing.');
  if (!isNum(r)) problems.push('Discount rate is missing.');
  if (isNum(tg) && isNum(r) && r <= tg) problems.push('The discount rate must be higher than the terminal growth rate.');
  return problems;
};

// Fair value per share from stored inputs. Returns null when the inputs are not valid.
// The sell price uses sellPremiumPct (default 0, so sell price = fair value).
export const fairValueFromInputs = (inputs) => {
  if (validateInputs(inputs).length > 0) return null;
  const perShare = perShareFcf(inputs);
  const result = computeDcfFairValue(
    perShare,
    toNumber(inputs.growthRate) / 100,
    toNumber(inputs.years),
    toNumber(inputs.terminalGrowth) / 100,
    toNumber(inputs.discountRate) / 100
  );
  if (!result) return null;

  let fairValue = result.fairValue;
  let netDebtPerShare = 0;
  if (inputs.fcfBasis === 'total') {
    const netDebt = toNumber(inputs.netDebt);
    if (isNum(netDebt)) {
      netDebtPerShare = netDebt / toNumber(inputs.sharesOutstanding);
      fairValue -= netDebtPerShare;
    }
  }

  const premium = toNumber(inputs.sellPremiumPct);
  const sellPremiumPct = isNum(premium) ? premium : 0;
  return {
    perShareFcf: perShare,
    ...result,
    netDebtPerShare,
    fairValue,
    sellPremiumPct,
    sellPrice: fairValue > 0 ? fairValue * (1 + sellPremiumPct / 100) : null,
  };
};

// ---------------------------------------------------------------------------
// Saved map: dcfInputs = { [TICKER]: entry }
// ---------------------------------------------------------------------------
// An entry is the inputs above plus: ticker, company, currency (the stock's own), nextReportDate
// ('YYYY-MM-DD' or ''), note, priceAtAnalysis (a price when it was saved, or null), updatedAt
// ('YYYY-MM-DD'). An entry may hold only a nextReportDate (no startingFcf yet): it has no valuation.

export const normalizeTicker = (t) => String(t ?? '').trim().toUpperCase();

// True for a real calendar date written as YYYY-MM-DD.
export const isValidIsoDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// What the dashboard shows for one entry: fair value, sell price and the display fields. Null when the
// entry has no valid valuation (for example it only holds a report date).
export const valuationFromInputs = (entry) => {
  const r = fairValueFromInputs(entry);
  if (!r || !(r.fairValue > 0)) return null;
  const price = toNumber(entry.priceAtAnalysis);
  return {
    ticker: normalizeTicker(entry.ticker),
    company: entry.company || normalizeTicker(entry.ticker),
    currency: entry.currency,
    fairValue: r.fairValue,
    sellPrice: r.sellPrice,
    sellPremiumPct: r.sellPremiumPct,
    priceAtAnalysis: isNum(price) && price > 0 ? price : null,
    note: entry.note || '',
    savedAt: entry.updatedAt || '',
  };
};

// Whole days from `today` to `dateStr` (both 'YYYY-MM-DD'): 0 is today, negative is in the past. Null if either
// is not a valid date. `today` is passed in, never read from the clock, so the result is reproducible.
export const daysUntil = (dateStr, today) => {
  if (!isValidIsoDate(dateStr) || !isValidIsoDate(today)) return null;
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
};

// Next report dates for the given held tickers, ready to list: upcoming ones (today or later) soonest first,
// then past ones, most recent first. Tickers without a valid date are left out; matching ignores case.
export const upcomingReports = (inputs, heldTickers, today) => {
  const map = inputs && typeof inputs === 'object' ? inputs : {};
  const seen = new Set();
  const rows = [];
  (Array.isArray(heldTickers) ? heldTickers : []).forEach((held) => {
    const ticker = normalizeTicker(held);
    if (!ticker || seen.has(ticker)) return;
    seen.add(ticker);
    const entry = map[ticker];
    const days = entry ? daysUntil(entry.nextReportDate, today) : null;
    if (days === null) return;
    rows.push({ ticker, company: entry.company || ticker, date: entry.nextReportDate, daysUntil: days, isPast: days < 0 });
  });
  return rows.sort((a, b) => {
    if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
    if (a.date !== b.date) return a.isPast ? (a.date < b.date ? 1 : -1) : (a.date < b.date ? -1 : 1);
    return a.ticker < b.ticker ? -1 : 1;
  });
};

// Converts the old `dcfValuations` map (per-share inputs plus a stored fair value) into `dcfInputs`
// entries. Never modifies its argument. `report` says how many entries were converted and lists any whose
// recomputed fair value differs from the one stored back then by more than half a cent per share.
export const migrateDcfValuations = (valuations) => {
  const inputs = {};
  const mismatches = [];
  const skipped = [];
  Object.values(valuations && typeof valuations === 'object' ? valuations : {}).forEach((v) => {
    const ticker = normalizeTicker(v?.ticker);
    if (!ticker) { skipped.push(v); return; }
    const entry = {
      ticker,
      company: v.company || ticker,
      currency: v.currency || 'USD',
      fcfBasis: 'perShare',
      startingFcf: v.startingFcf ?? '',
      sharesOutstanding: '',
      netDebt: '',
      growthRate: v.growthRate ?? '',
      years: v.years ?? '',
      terminalGrowth: v.terminalGrowth ?? '',
      discountRate: v.discountRate ?? '',
      sellPremiumPct: v.sellPremiumPct ?? 0,
      nextReportDate: '',
      note: v.note || '',
      priceAtAnalysis: v.priceAtAnalysis ?? null,
      updatedAt: v.savedAt || '',
    };
    inputs[ticker] = entry;
    const again = fairValueFromInputs(entry);
    if (!again || !isNum(toNumber(v.fairValue)) || Math.abs(again.fairValue - toNumber(v.fairValue)) > 0.005) {
      mismatches.push({ ticker, saved: v.fairValue ?? null, recomputed: again ? again.fairValue : null });
    }
  });
  return { inputs, report: { count: Object.keys(inputs).length, mismatches, skipped: skipped.length } };
};

// Fair value over a grid of discount rates (rows) and terminal growth rates (columns), centred
// on the inputs' own rates. `steps` are percentage-point offsets. Cells where the discount rate is
// not above terminal growth are null. Returns null if the base inputs are not valid.
export const sensitivityGrid = (inputs, steps = [-1, -0.5, 0, 0.5, 1]) => {
  if (validateInputs(inputs).length > 0) return null;
  const baseR = toNumber(inputs.discountRate);
  const baseTg = toNumber(inputs.terminalGrowth);
  const round2 = (x) => Math.round(x * 100) / 100;
  const discountSteps = steps.map((d) => round2(baseR + d));
  const terminalSteps = steps.map((d) => round2(baseTg + d));
  const grid = discountSteps.map((r) => terminalSteps.map((tg) => {
    const v = fairValueFromInputs({ ...inputs, discountRate: r, terminalGrowth: tg });
    return v ? v.fairValue : null;
  }));
  return { discountSteps, terminalSteps, grid };
};
