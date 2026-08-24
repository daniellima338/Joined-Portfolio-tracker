import yahooFinance from 'yahoo-finance2';

// GET /api/quote?tickers=AAPL,MSFT,NVO
// Returns { AAPL: { price, change, changePercent, currency, marketState, shortName }, ... }
export default async function handler(req, res) {
  const { tickers } = req.query;
  if (!tickers) {
    return res.status(400).json({ error: 'Missing tickers query param, e.g. ?tickers=AAPL,MSFT' });
  }

  const symbols = tickers.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) return res.status(200).json({});

  try {
    const quotes = await yahooFinance.quote(symbols);
    const list = Array.isArray(quotes) ? quotes : [quotes];

    const result = {};
    list.forEach((q) => {
      if (!q || !q.symbol) return;
      result[q.symbol] = {
        price: q.regularMarketPrice ?? null,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        currency: q.currency ?? 'USD',
        marketState: q.marketState ?? 'UNKNOWN',
        shortName: q.shortName || q.longName || q.symbol,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(result);
  } catch (err) {
    console.error('quote error', err);
    res.status(500).json({ error: 'Failed to fetch quotes from Yahoo Finance', details: String(err) });
  }
}
