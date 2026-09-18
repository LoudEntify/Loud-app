import { Suspense } from 'react';
import LiveDemo from '../../components/LiveDemo';

export const metadata = {
  title: 'Live · Loudentify',
  description: 'Watch and perform live on Loudentify',
};

// ── ⚠️ NO RequireAuth. THE AUDIENCE HAS NO ACCOUNT. ───────────
//
// This route was wrapped in RequireAuth, whose own header says "the
// anonymous viewer path is retired -- watching a show now requires an
// account". That was true when it was written and it is the exact
// opposite of what pilot 2 is:
//
//   the homepage says "Join as viewer -- no account needed"
//   the entry gate collects a name, an email and 18+ INSTEAD of an account
//   viewer_sessions is keyed on a device-scoped viewer_id, not a user_id
//   /api/token is deliberately public and subscribe-only, and its
//     allowlist entry reads "Viewers watch without an account, which is
//     a product decision"
//
// With the gate in place a first-time viewer was redirected to an ARTIST
// LOGIN PAGE and could not reach the show at all. On the night that is
// the whole audience.
//
// It survived every device test because the test devices were signed in.
// A genuinely signed-out viewer was never walked through end to end
// until 19 September.
//
// LiveDemo itself needs no gate and never did: it initialises session as
// `undefined`, resolves it to null for an anonymous visitor and sets
// identityReady, and enterShow skips /api/performer/join-show entirely
// when there is no access token, taking the viewer-token path instead.
//
// Performers are NOT unprotected by removing this. join-show requires a
// bearer and returns 403 to anyone not on the line-up, and every
// operator route is behind verifyArtistAuth plus verifyShowOwner. The
// gate was never what protected them.
export default function LivePage() {
  return (
    <main>
      <Suspense fallback={null}>
        <LiveDemo />
      </Suspense>
    </main>
  );
}
