import InterruptionProbe from '../../../components/InterruptionProbe';

export const metadata = {
  title: 'Interruption probe · Loudentify',
  description: 'Measures what a handset does to a live capture when the OS interrupts it',
};

// No RequireAuth, deliberately. The probe reaches no table, no storage
// bucket and no room — it captures locally, keeps the log on the device,
// and exports a file the operator downloads. There is nothing here for a
// session to protect, and a sign-in wall would only add a step to a test
// that has to be runnable on a borrowed handset in a venue.
//
// Not linked from anywhere in the app. It is an instrument, reached by
// typing the URL, and it should stay that way.
export default function InterruptionProbePage() {
  return (
    <main>
      <InterruptionProbe />
    </main>
  );
}
