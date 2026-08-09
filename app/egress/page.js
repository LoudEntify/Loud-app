import { Suspense } from 'react';
import EgressPage from '../../components/EgressPage';

export const metadata = {
  title: 'Egress · Loudentify pilot',
  description: 'Headless directed-view template for LiveKit room composite egress',
};

export default function EgressRoute() {
  return (
    <main>
      {/* useSearchParams() (inside EgressPage) requires a Suspense boundary
          in the app router, or the build fails. */}
      <Suspense fallback={null}>
        <EgressPage />
      </Suspense>
    </main>
  );
}
