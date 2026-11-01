import { notFound } from 'next/navigation';
import { devHarnessAllowed } from '../../../lib/paymentProvider';
import ViewerShell from '../../../components/viewer/ViewerShell';
import ControllerScreen from '../../../components/spike/ControllerScreen';

// SPIKE-ONLY. The laptop Controller for the device-zoom spike
// (docs/DIRECTOR_DATA_SPEC.md, branch spike/native-device-zoom): with one
// Android phone, the browser takes the role the second phone would.
//
// Gate: the same devHarnessAllowed() the spike API routes use, decided on
// the server before anything renders, so on production this URL is a
// plain 404 and the page's code is never sent. Sign-in is checked on the
// client (the artist session), and the token route checks it again.
//
// Not linked from anywhere. Reached by typing the URL on the staging
// preview. DELETE WITH app/api/spike/* WHEN THE SPIKE ENDS.
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Spike controller · Loudentify',
  robots: { index: false, follow: false },
};

export default function SpikeControllerPage() {
  if (!devHarnessAllowed()) notFound();
  return (
    <ViewerShell variant="dark" tabs={false} cookieBanner={false}>
      <ControllerScreen />
    </ViewerShell>
  );
}
