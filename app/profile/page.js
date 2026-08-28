import { Suspense } from 'react';
import MyProfileRedirect from '../../components/MyProfileRedirect';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Your profile · Loudentify',
  description: 'Your Loudentify profile',
};

export default function ProfilePage() {
  return (
    <PageShell active="profile">
      <Suspense fallback={null}>
        <MyProfileRedirect />
      </Suspense>
    </PageShell>
  );
}
