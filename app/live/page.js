// /live — the Live tab. The pilot's LiveKit show screen lived here as
// /live?show=<id>; those links still work (middleware.js rewrites them to
// /pilot/live).
import { Suspense } from 'react';
import ViewerShell from '../../components/viewer/ViewerShell';
import LiveTab from '../../components/viewer/LiveTab';
export const metadata = { title: 'Live · Loudentify' };
export default function LivePage() {
  return <ViewerShell><Suspense><LiveTab /></Suspense></ViewerShell>;
}
