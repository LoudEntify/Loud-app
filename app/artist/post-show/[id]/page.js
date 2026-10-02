import ViewerShell from '../../../../components/viewer/ViewerShell';
import PostShowScreen from '../../../../components/artist/PostShowScreen';
export const metadata = { title: 'Show ended · Loudentify' };
export default function Page({ params }) { return <ViewerShell tabs={false}><PostShowScreen showId={params.id} /></ViewerShell>; }
