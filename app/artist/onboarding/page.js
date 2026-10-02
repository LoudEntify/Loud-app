// /artist/onboarding — the five steps to a first show, including the
// YouTube connection. Built in Phase 3; until then a performer lands on
// the viewer onboarding (genres, follows) and the pilot console.
import { redirect } from 'next/navigation';
export default function ArtistOnboardingPage({ searchParams }) {
  redirect(`/onboarding?next=${encodeURIComponent(searchParams?.next || '/artist/create')}`);
}
