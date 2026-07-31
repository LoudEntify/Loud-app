import { Suspense } from 'react';
import CamPage from '../../components/CamPage';

export const metadata = {
  title: 'Camera · Loudentify pilot',
  description: 'QR-paired extra camera device',
};

export default function CamRoute() {
  return (
    <main>
      {/* useSearchParams() (inside CamPage) requires a Suspense boundary
          in the app router, or the build fails. */}
      <Suspense fallback={null}>
        <CamPage />
      </Suspense>
    </main>
  );
}
