import ViewerShell from '../../components/viewer/ViewerShell';
import ProfileHome from '../../components/viewer/ProfileHome';
export const metadata = { title: 'Your profile · Loudentify', description: 'Your Loudentify profile' };
export default function ProfilePage() { return <ViewerShell><ProfileHome /></ViewerShell>; }
