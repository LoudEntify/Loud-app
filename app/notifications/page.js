import Notifications from '../../components/Notifications';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Notifications · Loudentify pilot',
  description: 'Recent activity and alerts',
};

export default function NotificationsPage() {
  return (
    <PageShell active="notifications">
      <Notifications />
    </PageShell>
  );
}
