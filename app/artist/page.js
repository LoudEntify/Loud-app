import MyArtistProfile from '../../components/MyArtistProfile';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Your profile · Loudentify',
  description: 'Public artist profile',
};

export default function ArtistProfilePage() {
  return (
    <PageShell active="profile">
      <MyArtistProfile />
    </PageShell>
  );
}
