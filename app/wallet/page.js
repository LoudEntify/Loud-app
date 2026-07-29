import TokenWallet from '../../components/TokenWallet';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Wallet · Loudentify pilot',
  description: 'Token balance and purchase tiers',
};

export default function WalletPage() {
  return (
    <PageShell active="wallet">
      <TokenWallet />
    </PageShell>
  );
}
