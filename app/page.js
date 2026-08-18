import { Suspense } from 'react';
import LiveDemo from '../components/LiveDemo';

export default function HomePage() {
  return (
    <main>
      {/* useSearchParams() (inside LiveShowRail, mounted deep under
          LiveDemo on the viewer path) requires a Suspense boundary in
          the app router, or the build fails -- same convention as
          app/cam/page.js and app/egress/page.js. */}
      <Suspense fallback={null}>
        <LiveDemo />
      </Suspense>
    </main>
  );
}
