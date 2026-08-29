import { Suspense } from 'react';
import CamPair from '../../../components/CamPair';

export const metadata = {
  title: 'Pair camera · Loudentify',
  description: 'Pair this phone as an extra camera',
};

export default function CamPairPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <CamPair />
      </Suspense>
    </main>
  );
}
