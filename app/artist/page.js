import { Suspense } from 'react';
import MyProfileRedirect from '../../components/MyProfileRedirect';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Your profile · Loudentify',
  description: 'Your Loudentify profile',
};

// /artist with no id means "my profile". Resolves through the same
// helper as /profile and /dashboard so there is exactly one answer to
// "where do I live", regardless of which link got you here.
export default function ArtistIndexPage() {
  return (
    <PageShell active="profile">
      <Suspense fallback={null}>
        <MyProfileRedirect />
      </Suspense>
    </PageShell>
  );
}
