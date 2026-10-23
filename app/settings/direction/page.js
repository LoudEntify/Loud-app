import ViewerShell from '../../../components/viewer/ViewerShell';
import DirectionSettingsScreen from '../../../components/artist/DirectionSettingsScreen';
export const metadata = { title: 'Direction · Loudentify' };
export default function Page() { return <ViewerShell tabs={false}><DirectionSettingsScreen /></ViewerShell>; }
