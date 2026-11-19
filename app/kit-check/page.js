import { Suspense } from 'react';
import KitCheck from '../../components/KitCheck';
import PageShell from '../../components/PageShell';
import RequireAuth from '../../components/RequireAuth';

export const metadata = {
  title: 'Kit Check · Loudentify',
  description: 'Set up your camera, audio and cues locally — connected to nothing',
};

// Kit Check is an artist studio surface, so it keeps the regular artist
// navigation. It deliberately does not enable PageShell's live overlay:
// testing equipment is preparation, not an active broadcast.
export default function KitCheckPage() {
  const liveStreamingReady = Boolean(
    process.env.LIVEKIT_URL
    && process.env.LIVEKIT_API_KEY
    && process.env.LIVEKIT_API_SECRET
  );

  return (
    <PageShell active="live">
      <Suspense fallback={null}>
        <RequireAuth signInPath="/auth/artist">
          <KitCheck liveStreamingReady={liveStreamingReady} />
        </RequireAuth>
      </Suspense>
    </PageShell>
  );
}
