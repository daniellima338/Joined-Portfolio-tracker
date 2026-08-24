// GET /api/quote?tickers=AAPL,MSFT,NVO
export default async function handler(req, res) {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: 'Missing tickers query param' });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing FINNHUB_API_KEY' });

  const symbols = tickers.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) return res.status(200).json({});

  const result = {};

  // Each symbol is fetched independently — one unsupported/failing ticker
  // no longer breaks quotes for everything else in your portfolio.
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
      const r = await fetch(url);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Non-JSON response'); }
      if (!r.ok) throw new Error(data.error || `Finnhub error (status ${r.status})`);
      if (data.c == null || data.c === 0) throw new Error('No price — likely not a US-listed symbol on the free plan');

      result[symbol] = {
        price: data.c,
        change: data.d ?? 0,
        changePercent: data.dp ?? 0,
        currency: 'USD',
        marketState: 'UNKNOWN',
        shortName: symbol,
      };
    } catch (err) {
      console.error(`quote failed for ${symbol}:`, err.message || err);
      // silently skipped — the dashboard falls back to showing purchase price for this one ticker
    }
  }));

  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
  res.status(200).json(result);
}