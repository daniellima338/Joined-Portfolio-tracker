// GET /api/quote?tickers=AAPL,MSFT,NVO
export default async function handler(req, res) {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: 'Missing tickers query param' });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing FINNHUB_API_KEY' });

  const symbols = tickers.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) return res.status(200).json({});

  try {
    const result = {};
    await Promise.all(symbols.map(async (symbol) => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
      const r = await fetch(url);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response for ${symbol}: ${text.slice(0, 120)}`); }
      if (!r.ok) throw new Error(data.error || `Finnhub error for ${symbol}`);
      result[symbol] = {
        price: data.c ?? null,
        change: data.d ?? 0,
        changePercent: data.dp ?? 0,
        currency: 'USD',
        marketState: 'UNKNOWN',
        shortName: symbol,
      };
    }));
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(result);
  } catch (err) {
    console.error('quote error', err);
    res.status(500).json({ error: 'Failed to fetch quotes from Finnhub', details: String(err.message || err) });
  }
}