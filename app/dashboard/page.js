import ArtistDashboard from '../../components/ArtistDashboard';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Studio · Loudentify pilot',
  description: 'Artist dashboard',
};

export default function DashboardPage() {
  return (
    <PageShell active="profile">
      <ArtistDashboard />
    </PageShell>
  );
}
