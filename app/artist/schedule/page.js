import ViewerShell from '../../../components/viewer/ViewerShell';
import ScheduleScreen from '../../../components/artist/ScheduleScreen';
export const metadata = { title: 'Schedule a show · Loudentify' };
export default function Page() { return <ViewerShell tabs={false}><ScheduleScreen /></ViewerShell>; }
