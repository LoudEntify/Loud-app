import FanProfile from '../../components/FanProfile';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Profile · Loudentify pilot',
  description: 'Your fan profile',
};

export default function FanProfilePage() {
  return (
    <PageShell active="profile">
      <FanProfile />
    </PageShell>
  );
}
