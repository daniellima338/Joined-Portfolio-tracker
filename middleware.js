import { NextResponse } from 'next/server';

// Password-protects the whole app (pages AND /api routes) with the browser's
// built-in login prompt (HTTP Basic Auth). The password comes from the
// APP_PASSWORD environment variable in Vercel. Any username is accepted —
// only the password is checked. The browser remembers it until it's closed.
//
// /api/export is left out here because it has its own key (EXPORT_TOKEN).

export const config = {
  matcher: ['/((?!api/export|_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(req) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse('App is locked: APP_PASSWORD is not set in Vercel.', { status: 503 });
  }

  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (given === password) return NextResponse.next();
    } catch (e) {
      // malformed header — fall through to the login prompt
    }
  }

  return new NextResponse('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Commingled", charset="UTF-8"' },
  });
}
