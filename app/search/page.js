import ViewerShell from '../../components/viewer/ViewerShell';
import SearchScreen from '../../components/viewer/SearchScreen';
export const metadata = { title: 'Search · Loudentify' };
export default function SearchPage({ searchParams }) {
  return <ViewerShell><SearchScreen initialQuery={searchParams?.q || ''} /></ViewerShell>;
}
