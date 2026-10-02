// middleware.js — URL shapes the product promises (docs/USER_JOURNEY.md:
// "loudentify.app/show/..., /@username, /clip/... and /invite/... open the
// app when installed and the web otherwise").
//   /@username        -> /u/username  (Next.js reserves @folders for slots)
//   /live?show=<id>   -> /pilot/live?show=<id>  (the pilot's LiveKit show
//                        screen, so links from the pilot still work)
import { NextResponse } from 'next/server';

export function middleware(request) {
  const url = request.nextUrl;
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

export const config = { matcher: ['/live', '/@:username*'] };
