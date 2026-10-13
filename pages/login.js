import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        const next = typeof router.query.next === 'string' ? router.query.next : '/';
        // Only follow same-site paths.
        window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
        return;
      }
      setError(r.status === 401 ? 'Wrong password.' : 'Could not sign in. Try again.');
    } catch (err) {
      setError('Could not sign in. Check your connection and try again.');
    }
    setBusy(false);
  };

  return (
    <>
      <Head><title>Commingled</title></Head>
      <style jsx global>{`
        html, body { margin: 0; background: #111110; }
      `}</style>
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Inter, system-ui, sans-serif', color: '#ece8de' }}>
        <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, background: '#1a1a18', border: '1px solid #2f2f2b', borderRadius: 6, padding: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#75726a' }}>Commingled</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 600, fontSize: 24, margin: '4px 0 16px' }}>Sign in</h1>
          <label htmlFor="pw" style={{ display: 'block', fontSize: 12, color: '#a7a396', marginBottom: 4 }}>Password</label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', background: '#222220', color: '#ece8de', border: '1px solid #2f2f2b', borderRadius: 4, padding: '10px 12px', fontSize: 16 }}
          />
          {error && <div role="alert" style={{ color: '#e07a6b', fontSize: 13, marginTop: 8 }}>{error}</div>}
          <button
            type="submit"
            disabled={busy || !password}
            style={{ marginTop: 16, width: '100%', background: '#d3a94b', color: '#17130a', border: 0, borderRadius: 4, padding: '10px 14px', fontSize: 15, fontWeight: 600, cursor: busy || !password ? 'default' : 'pointer', opacity: busy || !password ? 0.6 : 1 }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </>
  );
}
