import ViewerShell from '../../components/viewer/ViewerShell';
import WalletScreen from '../../components/viewer/WalletScreen';
export const metadata = { title: 'Wallet · Loudentify' };
export default function WalletPage() {
  return <ViewerShell><WalletScreen /></ViewerShell>;
}
