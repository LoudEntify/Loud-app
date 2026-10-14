import AccountSettings from '../../components/AccountSettings';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Settings · Loudentify pilot',
  description: 'Account and security settings',
};

export default function SettingsPage({ searchParams }) {
  const yt = searchParams?.youtube;
  return (
    <PageShell active="profile">
      <AccountSettings youtubeResult={yt === 'connected' || yt === 'error' ? yt : null} />
    </PageShell>
  );
}
