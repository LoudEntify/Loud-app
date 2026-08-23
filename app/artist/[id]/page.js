import { Suspense } from 'react';
import ProfileSurface from '../../../components/ProfileSurface';

export const metadata = {
  title: 'Profile · Loudentify',
  description: 'Artist profile',
};

// ONE route, two modes. The owner gets their console here; everyone else
// gets the storefront at the SAME url. Which one you see is decided by
// who you are, not by which link you followed.
export default function ArtistProfileRoute({ params }) {
  return (
    <main>
      <Suspense fallback={null}>
        <ProfileSurface artistId={params.id} />
      </Suspense>
    </main>
  );
}
