import ArtistProfile from '../../components/ArtistProfile';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Artist Profile · Loudentify pilot',
  description: 'Public artist profile',
};

export default function ArtistProfilePage() {
  return (
    <PageShell active="profile">
      <ArtistProfile />
    </PageShell>
  );
}
