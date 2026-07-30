import Competitions from '../../components/Competitions';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Competitions · Loudentify pilot',
  description: 'Open artist competitions',
};

export default function CompetitionsPage() {
  return (
    <PageShell active="discover">
      <Competitions />
    </PageShell>
  );
}
