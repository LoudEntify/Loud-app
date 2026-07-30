import AccountSettings from '../../components/AccountSettings';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Settings · Loudentify pilot',
  description: 'Account and security settings',
};

export default function SettingsPage() {
  return (
    <PageShell active="profile">
      <AccountSettings />
    </PageShell>
  );
}
