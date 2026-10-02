import { Suspense } from 'react';
import ViewerShell from '../../../components/viewer/ViewerShell';
import KitCheckScreen from '../../../components/artist/KitCheckScreen';
export const metadata = { title: 'Kit check · Loudentify' };
export default function Page({ searchParams }) { return <ViewerShell variant="dark" tabs={false}><Suspense><KitCheckScreen showId={searchParams?.show || null} /></Suspense></ViewerShell>; }
