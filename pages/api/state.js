import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const STATE_KEY = 'commingled:portfolio-state';
const REVISION_KEY = 'commingled:portfolio-revision';

// Stale-tab guard. Every successful save bumps a revision number kept beside
// the state. A save must say which revision it was based on (baseRevision);
// if someone else has saved since, it is refused (409) and the page reloads
// instead of overwriting their newer data. The compare-and-write runs as one
// Lua script so two saves arriving together cannot both win.
const SAVE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if current ~= tonumber(ARGV[1]) then return {0, current} end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(current + 1))
return {1, current + 1}
`;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const [data, rev] = await Promise.all([redis.get(STATE_KEY), redis.get(REVISION_KEY)]);
      const revision = Number(rev) || 0;
      return res.status(200).json({ ...(data && typeof data === 'object' ? data : {}), revision });
    } catch (err) {
      console.error('state GET error', err);
      return res.status(500).json({ error: 'Failed to load saved data', details: String(err.message || err) });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

      // eslint-disable-next-line no-unused-vars
      const { baseRevision, revision, ...state } = body;
      if (!Number.isInteger(baseRevision) || baseRevision < 0) {
        // An older page that predates the guard: refuse rather than risk clobbering newer data.
        return res.status(409).json({ error: 'stale', reason: 'missing_revision' });
      }

      const [ok, newRevision] = await redis.eval(
        SAVE_SCRIPT,
        [STATE_KEY, REVISION_KEY],
        [String(baseRevision), JSON.stringify(state)]
      );
      if (Number(ok) !== 1) {
        return res.status(409).json({ error: 'stale', currentRevision: Number(newRevision) });
      }
      return res.status(200).json({ ok: true, revision: Number(newRevision) });
    } catch (err) {
      console.error('state POST error', err);
      return res.status(500).json({ error: 'Failed to save data', details: String(err.message || err) });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
