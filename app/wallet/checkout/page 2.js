import { Suspense } from 'react';
import DevCheckout from '../../../components/DevCheckout';
import PageShell from '../../../components/PageShell';
import RequireAuth from '../../../components/RequireAuth';

export const metadata = {
  title: 'Checkout · Loudentify',
  description: 'Complete your token purchase',
};

// Only ever reached when the DEV payment provider is active — a real
// provider's checkout URL points at the provider's own domain, not here.
// Behind RequireAuth because settling an intent requires proving it is
// yours (app/api/wallet/dev-event checks the same thing server-side).
export default function CheckoutPage() {
  return (
    <PageShell active="wallet">
      <Suspense fallback={null}>
        <RequireAuth>
          <DevCheckout />
        </RequireAuth>
      </Suspense>
    </PageShell>
  );
}
