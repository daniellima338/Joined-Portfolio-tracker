import { NextResponse } from 'next/server';

// Password-protects the whole app (pages AND /api routes). The password comes
// from the APP_PASSWORD environment variable in Vercel.
//
// Visitors sign in on /login, which sets an HttpOnly cookie. Scripts can also
// send the password with HTTP Basic Auth (any username). /api/export is left
// out here because it has its own key (EXPORT_TOKEN).

export const config = {
  matcher: ['/((?!api/export|api/login|login|_next/static|_next/image|favicon.ico).*)'],
};

// Must match the hash created in pages/api/login.js.
const sessionValue = async (password) => {
  const bytes = new TextEncoder().encode(`commingled:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function middleware(req) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse('App is locked: APP_PASSWORD is not set in Vercel.', { status: 503 });
  }

  const cookie = req.cookies.get('cm_auth')?.value;
  if (cookie && cookie === (await sessionValue(password))) return NextResponse.next();

  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (given === password) return NextResponse.next();
    } catch (e) {
      // malformed header — fall through
    }
  }

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Password required' }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  const target = req.nextUrl.pathname + req.nextUrl.search;
  if (target !== '/') loginUrl.searchParams.set('next', target);
  return NextResponse.redirect(loginUrl);
}
