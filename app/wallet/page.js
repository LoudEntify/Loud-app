import { Suspense } from 'react';
import TokenWallet from '../../components/TokenWallet';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Wallet · Loudentify',
  description: 'Token balance, purchases and transaction history',
};

// Suspense is required, not optional: TokenWallet reads useSearchParams()
// (to notice the ?purchase=complete return from a checkout), and the app
// router refuses to prerender a page that does so without a boundary.
export default function WalletPage() {
  return (
    <PageShell active="wallet">
      <Suspense fallback={null}>
        <TokenWallet />
      </Suspense>
    </PageShell>
  );
}
