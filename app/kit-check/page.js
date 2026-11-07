import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { pilotReachable } from '../../lib/pilotJourney';
import KitCheck from '../../components/KitCheck';
import RequireAuth from '../../components/RequireAuth';

export const metadata = {
  title: 'Kit Check · Loudentify',
  description: 'Set up your camera, audio and cues locally — connected to nothing',
};

// Deliberately NOT wrapped in PageShell's live overlay chrome: Kit Check
// is a studio surface, not a broadcast one, and the distinction should be
// visible the moment the page loads.
// RETIRED (lib/pilotJourney.js). This is the PILOT's Kit Check. The
// product's is /artist/kit-check. Both routed, so anyone with an old
// link or an old habit landed in the previous product — which is what
// Korey reported on 5 Nov.
//
// Gated rather than deleted, because components/KitCheck.jsx is still
// the only working version of several capabilities the new journey has
// yet to be given (docs/ONE_JOURNEY.md §7). Decided on the server, so
// the URL is a plain 404 and this page's code is never sent.
export default function KitCheckPage() {
  if (!pilotReachable(process.env.VERCEL_ENV === 'production')) notFound();
  return (
    <main>
      <Suspense fallback={null}>
        <RequireAuth>
          <KitCheck />
        </RequireAuth>
      </Suspense>
    </main>
  );
}
