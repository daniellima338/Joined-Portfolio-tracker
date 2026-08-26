import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const STATE_KEY = 'commingled:portfolio-state';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const data = await redis.get(STATE_KEY);
      return res.status(200).json(data || null);
    } catch (err) {
      console.error('state GET error', err);
      return res.status(500).json({ error: 'Failed to load saved data', details: String(err.message || err) });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });
      await redis.set(STATE_KEY, body);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('state POST error', err);
      return res.status(500).json({ error: 'Failed to save data', details: String(err.message || err) });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
