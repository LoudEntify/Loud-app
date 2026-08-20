import ArtistProfilePublic from '../../../components/ArtistProfilePublic';
import PageShell from '../../../components/PageShell';

export const metadata = {
  title: 'Artist Profile · Loudentify pilot',
  description: 'Public artist profile',
};

export default function ArtistPublicPage({ params }) {
  return (
    <PageShell active="profile">
      <ArtistProfilePublic artistId={params.id} />
    </PageShell>
  );
}
