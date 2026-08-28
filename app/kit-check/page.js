import { Suspense } from 'react';
import KitCheck from '../../components/KitCheck';
import RequireAuth from '../../components/RequireAuth';

export const metadata = {
  title: 'Kit Check · Loudentify',
  description: 'Set up your camera, audio and cues locally — connected to nothing',
};

// Deliberately NOT wrapped in PageShell's live overlay chrome: Kit Check
// is a studio surface, not a broadcast one, and the distinction should be
// visible the moment the page loads.
export default function KitCheckPage() {
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
