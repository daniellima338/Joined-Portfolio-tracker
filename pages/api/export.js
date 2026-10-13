import { Redis } from '@upstash/redis';

// GET /api/export?key=YOUR_EXPORT_TOKEN            -> JSON (holdings, lots, sales, dividends)
// GET /api/export?key=YOUR_EXPORT_TOKEN&format=csv -> CSV of current holdings (one row per ticker)
//
// Read-only snapshot of the portfolio for analysis. Protected by the
// EXPORT_TOKEN environment variable (set it in Vercel -> Settings ->
// Environment Variables). Without a matching key the endpoint returns 401.

const redis = Redis.fromEnv();
const STATE_KEY = 'commingled:portfolio-state';

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.EXPORT_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server is missing EXPORT_TOKEN' });
  const auth = req.headers.authorization || '';
  const given = req.query.key || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (given !== token) return res.status(401).json({ error: 'Unauthorized' });

  let state;
  try {
    state = (await redis.get(STATE_KEY)) || {};
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load saved data', details: String(err.message || err) });
  }

  const owners = Array.isArray(state.owners) ? state.owners : [];
  const lots = Array.isArray(state.lots) ? state.lots : [];
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const dividends = Array.isArray(state.dividends) ? state.dividends : [];
  const ownerName = Object.fromEntries(owners.map((o) => [o.id, o.name]));
  const namesFor = (ids = []) => (ids.length ? ids.map((id) => ownerName[id] || id) : ['Unassigned']);

  // Lots as stored (one row per purchase), with owner names resolved.
  const lotRows = lots.map((l) => ({
    ticker: l.ticker,
    company: l.company,
    shares: l.shares,
    purchasePrice: l.purchasePrice,
    currency: l.currency,
    costBasis: +(l.shares * l.purchasePrice).toFixed(2),
    dateBought: l.dateBought,
    owners: namesFor(l.ownerIds),
  }));

  // Holdings: lots merged per ticker with weighted-average cost.
  const byTicker = {};
  lots.forEach((l) => {
    const h = byTicker[l.ticker] || (byTicker[l.ticker] = {
      ticker: l.ticker, company: l.company, currency: l.currency,
      shares: 0, costBasis: 0, firstBought: l.dateBought, lastBought: l.dateBought, owners: new Set(),
    });
    h.shares += l.shares;
    h.costBasis += l.shares * l.purchasePrice;
    if (l.dateBought && (!h.firstBought || l.dateBought < h.firstBought)) h.firstBought = l.dateBought;
    if (l.dateBought && (!h.lastBought || l.dateBought > h.lastBought)) h.lastBought = l.dateBought;
    namesFor(l.ownerIds).forEach((n) => h.owners.add(n));
  });
  const holdings = Object.values(byTicker)
    .map((h) => ({
      ...h,
      shares: +h.shares.toFixed(6),
      costBasis: +h.costBasis.toFixed(2),
      avgCost: h.shares ? +(h.costBasis / h.shares).toFixed(4) : 0,
      owners: [...h.owners],
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  res.setHeader('Cache-Control', 'no-store');

  if (req.query.format === 'csv') {
    const header = ['ticker', 'company', 'currency', 'shares', 'avgCost', 'costBasis', 'firstBought', 'lastBought', 'owners'];
    const rows = holdings.map((h) => header.map((k) => csvCell(k === 'owners' ? h.owners.join(' + ') : h[k])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="commingled-holdings-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send([header.join(','), ...rows].join('\n'));
  }

  return res.status(200).json({
    exportedAt: new Date().toISOString(),
    owners: owners.map((o) => o.name),
    holdings,
    lots: lotRows,
    sales: sales.map((s) => ({
      ticker: s.ticker, company: s.company, currency: s.currency, shares: s.shares,
      costBasisPerShare: s.costBasisPerShare, sellPrice: s.sellPrice, saleDate: s.saleDate,
      realizedGainAbs: s.realizedGainAbs, owners: namesFor(s.ownerIds),
    })),
    dividends: dividends.map((d) => ({
      ticker: d.ticker, company: d.company, currency: d.currency, amount: d.amount,
      payDate: d.payDate, owners: namesFor(d.ownerIds),
    })),
  });
}
