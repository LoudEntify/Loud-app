'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ArtistProfilePublic from './ArtistProfilePublic';
import EmptyState from './EmptyState';
import AuthButton from './AuthButton';
import { getSession } from '../lib/supabaseAuth';

// `/artist` used to render a fully invented artist (Neon Meridian) with
// invented clips, invented upcoming shows, invented engagement bars and
// invented external links.
//
// It now renders the SIGNED-IN artist's own real public profile, through
// the exact component fans see at /artist/[id] -- so an artist is always
// looking at the same page their audience is, rather than at a mockup
// that flatters it.
export default function MyArtistProfile() {
  const [userId, setUserId] = useState(undefined); // undefined = loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (!cancelled) setUserId(session?.user?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  if (userId === undefined) {
    return <div style={{ padding: 40, fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>;
  }

  if (!userId) {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState
          title="Sign in to see your profile"
          body="Your public artist page is built from your account."
          action="LOG IN"
          actionHref="/auth"
        />
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '16px 40px 0' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.45)' }}>
          THIS IS YOUR PUBLIC PAGE — <Link href="/settings" style={{ color: '#2ec4b6' }}>EDIT PROFILE</Link>
        </div>
        <AuthButton />
      </div>
      <ArtistProfilePublic artistId={userId} />
    </>
  );
}
