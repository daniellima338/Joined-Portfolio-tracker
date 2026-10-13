import { createHash } from 'crypto';

// POST /api/login  { password }  -> sets the cm_auth cookie checked by middleware.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const password = process.env.APP_PASSWORD;
  if (!password) return res.status(503).json({ error: 'APP_PASSWORD is not set in Vercel.' });

  const given = typeof req.body?.password === 'string' ? req.body.password : '';
  if (given !== password) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ error: 'Wrong password' });
  }

  const value = createHash('sha256').update(`commingled:${password}`).digest('hex');
  const maxAge = 60 * 60 * 24 * 30; // 30 days
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `cm_auth=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`);
  return res.status(200).json({ ok: true });
}
