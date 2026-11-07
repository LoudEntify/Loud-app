// middleware.js — the URL shapes the product promises, and the gate
// that closes the public site.
//
// ── THE URL SHAPES (docs/USER_JOURNEY.md) ─────────────────────
//   /@username        -> /u/username  (Next.js reserves @folders for slots)
//   /live?show=<id>   -> /show/<id>  (a pilot share link, answered by the
//                        show screen the product actually has)
//
// The gate that closes the public site lives in lib/siteGate.js —
// separate so it can be run and tested without Next.js.
import { NextResponse } from 'next/server';
import { shouldGate, GATE_PAGE } from './lib/siteGate';
import { showPathFor } from './lib/pilotJourney';

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
  // A pilot share link. It used to be rewritten into /pilot/live, which
  // is how people with old links kept landing in the old product
  // (lib/pilotJourney.js). It now goes to the show screen the product
  // has — a REDIRECT rather than a rewrite, so the address bar shows
  // where they actually are and the link they copy next is the real one.
  const show = url.searchParams.get('show');
  if (url.pathname === '/live' && show) {
    const to = url.clone();
    to.pathname = showPathFor(show);
    to.searchParams.delete('show');
    return NextResponse.redirect(to);
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
