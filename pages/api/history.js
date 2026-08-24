import yahooFinance from 'yahoo-finance2';

// GET /api/history?ticker=AAPL
// Returns [{ date, close }, ...] for the last 30 calendar days
export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker query param' });

  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setDate(period1.getDate() - 30);

    const result = await yahooFinance.chart(ticker, { period1, period2, interval: '1d' });
    const points = (result.quotes || [])
      .filter((q) => q.close != null)
      .map((q) => ({ date: q.date, close: q.close }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(points);
  } catch (err) {
    console.error('history error', err);
    res.status(500).json({ error: 'History fetch failed', details: String(err) });
  }
}
