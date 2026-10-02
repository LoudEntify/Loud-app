import { Suspense } from 'react';
import ViewerShell from '../../../components/viewer/ViewerShell';
import ArtistOnboardingScreen from '../../../components/artist/ArtistOnboardingScreen';
export const metadata = { title: 'Set up your stage · Loudentify' };
export default function Page({ searchParams }) {
  return <ViewerShell tabs={false}><Suspense><ArtistOnboardingScreen next={searchParams?.next || '/profile'} youtubeResult={searchParams?.youtube || null} /></Suspense></ViewerShell>;
}
