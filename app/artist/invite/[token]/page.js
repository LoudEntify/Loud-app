import ViewerShell from '../../../../components/viewer/ViewerShell';
import InviteAcceptScreen from '../../../../components/artist/InviteAcceptScreen';
export const metadata = { title: 'Versus invite · Loudentify' };
export default function Page({ params }) { return <ViewerShell tabs={false}><InviteAcceptScreen token={params.token} /></ViewerShell>; }
