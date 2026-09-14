import { NextResponse } from 'next/server';

// ── WHICH COMMIT IS THIS? ─────────────────────────────────────
//
// AUTH MODEL: public, read-only, no session. It returns the git SHA of
// the running deployment and nothing else — the same information the
// Vercel dashboard shows for any deployment, and the repository is the
// team's own. Nothing here is a secret, nothing here is a write.
//
// This exists because a device test against a MOVING url is not a test.
// A Vercel branch alias (loud-app-git-<branch>-…) points at the newest
// build of that branch, so a rebuild of an older commit silently sends
// the alias backwards, and the tester is then debugging code that is not
// the code they think they are looking at. That happened, and it cost a
// morning.
//
// So: curl this before a device test and confirm the sha matches the
// commit you meant to test. The same value is rendered in the on-screen
// stale-state overlay (?stale=1), so the number is visible at the moment
// of the test rather than only before it.
// Named build-info, not build: `build/` is in .gitignore, so a route at
// app/api/build would be silently untracked and would never deploy.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    // Vercel sets these on every deployment. Locally they are absent,
    // which is itself the correct answer: "not a deployment".
    sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    shortSha: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
    env: process.env.VERCEL_ENV || 'development',
    // The immutable per-deployment host. THIS is the url to device test
    // against: it is pinned to one build and can never move under you,
    // unlike the branch alias.
    deploymentUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  });
}
