// GET /api/search?q=novo
export default async function handler(req, res) {
  const { q } = req.query;
  if (!q || !q.trim()) return res.status(200).json([]);

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing FINNHUB_API_KEY' });

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q.trim())}&token=${apiKey}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Finnhub search failed');

    // No longer filtering out non-US symbols (e.g. NOVO-B.CO) — the client
    // will fall back to fetching those directly from Yahoo Finance if
    // Finnhub can't price them.
    const stocks = (data.result || [])
      .filter((item) => item.type === 'Common Stock' || item.type === 'ETP')
      .slice(0, 8)
      .map((item) => ({ ticker: item.symbol, company: item.description }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json(stocks);
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'Search failed', details: String(err.message || err) });
  }
}
