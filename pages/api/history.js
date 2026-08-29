// GET /api/history?ticker=AAPL&days=90 (or days=all for full history)
// Uses Stooq's free daily CSV feed — no API key needed.
export default async function handler(req, res) {
  const { ticker, days } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker query param' });

  try {
    const symbol = `${ticker.trim().toLowerCase()}.us`;
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
    const r = await fetch(url);
    const text = await r.text();

    if (!text || text.trim().length === 0 || text.startsWith('No data')) {
      return res.status(200).json([]);
    }

    const rows = text.trim().split('\n').slice(1); // drop header row
    let points = rows
      .map((line) => {
        const [date, , , , close] = line.split(',');
        return { date, close: parseFloat(close) };
      })
      .filter((p) => p.date && !Number.isNaN(p.close));

    if (days !== 'all') {
      const n = parseInt(days, 10);
      points = points.slice(-(Number.isFinite(n) && n > 0 ? n : 30));
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(points);
  } catch (err) {
    console.error('history error', err);
    res.status(500).json({ error: 'History fetch failed', details: String(err.message || err) });
  }
}