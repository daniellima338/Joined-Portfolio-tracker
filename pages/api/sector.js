// GET /api/sector?tickers=AAPL,MSFT,NVO
// Uses Finnhub's free /stock/profile2 endpoint to classify each ticker's
// industry, which the client buckets into a broader sector for the
// Sectors & underlying holdings breakdown. Tickers Finnhub has no profile
// for (mainly ETFs) are simply left out of the response — the client
// treats a missing entry as "Unknown".
export default async function handler(req, res) {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: 'Missing tickers query param' });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing FINNHUB_API_KEY' });

  const symbols = tickers.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) return res.status(200).json({});

  const result = {};

  await Promise.all(symbols.map(async (symbol) => {
    try {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
      const r = await fetch(url);
      const data = await r.json();
      if (data && data.finnhubIndustry) result[symbol] = data.finnhubIndustry;
    } catch (err) {
      console.error(`sector lookup failed for ${symbol}:`, err.message || err);
    }
  }));

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800'); // industry classification barely changes
  res.status(200).json(result);
}
