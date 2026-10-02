import { Suspense } from 'react';
import ViewerShell from '../../../../components/viewer/ViewerShell';
import ClipEditorScreen from '../../../../components/artist/ClipEditorScreen';
export const metadata = { title: 'New clip · Loudentify' };
export default function Page({ searchParams }) { return <ViewerShell tabs={false}><Suspense><ClipEditorScreen recordingId={searchParams?.recording || null} /></Suspense></ViewerShell>; }
