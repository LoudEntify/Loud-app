import { Suspense } from 'react';
import AcceptInvite from '../../../components/AcceptInvite';

export const metadata = {
  title: 'Show invite · Loudentify',
  description: 'You have been invited to perform',
};

// Deliberately NOT behind RequireAuth: the invite should be readable
// before you have an account, so someone can see what they are being
// asked to join before deciding to sign up. Accepting still requires
// being logged in -- that check lives in the component and in the API.
export default function JoinPage({ params }) {
  return (
    <main>
      <Suspense fallback={null}>
        <AcceptInvite token={params.token} />
      </Suspense>
    </main>
  );
}
