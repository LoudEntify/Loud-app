import ViewerShell from '../../../../components/viewer/ViewerShell';
import ConsoleScreen from '../../../../components/artist/ConsoleScreen';
export const metadata = { title: 'Live console · Loudentify' };
export default function Page({ params }) { return <ViewerShell variant="dark" tabs={false} cookieBanner={false}><ConsoleScreen showId={params.id} /></ViewerShell>; }
