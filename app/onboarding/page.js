import { Suspense } from 'react';
import ViewerShell from '../../components/viewer/ViewerShell';
import OnboardingScreen from '../../components/viewer/OnboardingScreen';
export const metadata = { title: 'Welcome · Loudentify' };
export default function OnboardingPage({ searchParams }) {
  return <ViewerShell tabs={false}><Suspense><OnboardingScreen next={searchParams?.next || '/discover'} /></Suspense></ViewerShell>;
}
