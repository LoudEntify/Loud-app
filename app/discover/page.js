import DiscoverFeed from '../../components/DiscoverFeed';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Discover · Loudentify pilot',
  description: 'Live shows and artists to follow',
};

export default function DiscoverPage() {
  return (
    <PageShell active="discover">
      <DiscoverFeed />
    </PageShell>
  );
}
