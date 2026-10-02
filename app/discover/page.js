import ViewerShell from '../../components/viewer/ViewerShell';
import Discover from '../../components/viewer/Discover';
export const metadata = { title: 'Discover · Loudentify' };
export default function DiscoverPage() {
  return <ViewerShell variant="dark"><Discover /></ViewerShell>;
}
