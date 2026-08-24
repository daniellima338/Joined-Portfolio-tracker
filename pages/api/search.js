import yahooFinance from 'yahoo-finance2';

// GET /api/search?q=novo
// Returns [{ ticker, company }, ...]
export default async function handler(req, res) {
  const { q } = req.query;
  if (!q || !q.trim()) return res.status(200).json([]);

  try {
    const results = await yahooFinance.search(q.trim());
    const stocks = (results.quotes || [])
      .filter((r) => r.symbol && (r.quoteType === 'EQUITY' || r.quoteType === 'ETF'))
      .slice(0, 8)
      .map((r) => ({ ticker: r.symbol, company: r.shortname || r.longname || r.symbol }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json(stocks);
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'Search failed', details: String(err) });
  }
}
