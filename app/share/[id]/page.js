import { Suspense } from 'react';
import ShareRecording from '../../../components/ShareRecording';
import RequireAuth from '../../../components/RequireAuth';

export const metadata = {
  title: 'Share · Loudentify',
  description: 'Share a recording',
};

export default function SharePage({ params }) {
  return (
    <main>
      <Suspense fallback={null}>
        <RequireAuth>
          <ShareRecording recordingId={params.id} />
        </RequireAuth>
      </Suspense>
    </main>
  );
}
