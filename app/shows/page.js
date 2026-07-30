import RecordedShows from '../../components/RecordedShows';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Recorded Shows · Loudentify pilot',
  description: 'Past show replays',
};

export default function RecordedShowsPage() {
  return (
    <PageShell active="profile">
      <RecordedShows />
    </PageShell>
  );
}
