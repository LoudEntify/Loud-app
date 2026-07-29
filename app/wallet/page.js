import TokenWallet from '../../components/TokenWallet';

export const metadata = {
  title: 'Wallet · Loudentify pilot',
  description: 'Token balance and purchase tiers',
};

export default function WalletPage() {
  return (
    <main>
      <TokenWallet />
    </main>
  );
}
