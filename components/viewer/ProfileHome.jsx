'use client';
// components/viewer/ProfileHome.jsx — /profile: the owner console for an
// artist, the fan's own profile for a viewer, a sign-in nudge for a guest.
// The server decides what each role may read; this only picks the screen.
import { useSession } from '../../lib/useSession';
import OwnerProfileScreen from '../artist/OwnerProfileScreen';
import FanProfile from '../FanProfile';
import { Skeleton, Empty } from './States';

export default function ProfileHome() {
  const { session, profile, loading } = useSession();
  if (loading) return <div className="v-screen" role="status" aria-label="Loading profile"><Skeleton w={88} h={88} r={44} /><Skeleton w="50%" h={28} /><Skeleton h={64} /></div>;
  if (!session) return <div className="v-screen"><Empty title="Your profile lives with your account" body="Sign up free to follow artists, set reminders and hold tokens." action="Sign up free" actionHref="/signup?trigger=profile" /><a className="v-link" style={{ alignSelf: 'center' }} href="/login">Log in</a></div>;
  if (profile?.role === 'artist') return <OwnerProfileScreen />;
  return <div className="v-screen"><FanProfile /></div>;
}
