// middleware.js — the URL shapes the product promises, and the gate
// that closes the public site.
//
// ── THE URL SHAPES (docs/USER_JOURNEY.md) ─────────────────────
//   /@username        -> /u/username  (Next.js reserves @folders for slots)
//   /live?show=<id>   -> /pilot/live?show=<id>  (the pilot's LiveKit show
//                        screen, so links from the pilot still work)
//
// The gate that closes the public site lives in lib/siteGate.js —
// separate so it can be run and tested without Next.js.
import { NextResponse } from 'next/server';
import { shouldGate, GATE_PAGE } from './lib/siteGate';

export function middleware(request) {
  const url = request.nextUrl;

  if (shouldGate(url.pathname, process.env)) {
    const to = url.clone();
    to.pathname = GATE_PAGE;
    to.search = '';
    return NextResponse.rewrite(to);
  }

  const m = url.pathname.match(/^\/@([a-z0-9_]{3,20})$/i);
  if (m) {
    const to = url.clone(); to.pathname = `/u/${m[1].toLowerCase()}`;
    return NextResponse.rewrite(to);
  }
  if (url.pathname === '/live' && url.searchParams.get('show')) {
    const to = url.clone(); to.pathname = '/pilot/live';
    return NextResponse.rewrite(to);
  }
  return NextResponse.next();
}

// Everything except Next's own internals and the static files the
// coming-soon page is built from. The gate has to see every page for
// the gate to mean anything; the two rewrites above still only fire on
// their own paths.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo/|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js|txt|xml)$).*)'],
};
