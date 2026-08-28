import { Suspense } from 'react';
import MyProfileRedirect from '../../components/MyProfileRedirect';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Your profile · Loudentify',
  description: 'Your Loudentify profile and console',
};

// /dashboard is retained ONLY so existing links and bookmarks do not
// 404. The console moved onto the artist's own profile; this resolves
// there. Nothing renders a "dashboard" as its own destination now.
export default function DashboardPage() {
  return (
    <PageShell active="profile">
      <Suspense fallback={null}>
        <MyProfileRedirect />
      </Suspense>
    </PageShell>
  );
}
