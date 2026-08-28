import { Suspense } from 'react';
import { createClient } from '@supabase/supabase-js';
import ProfileSurface from '../../../components/ProfileSurface';

// Phase 4d — an artist profile is a share target too.
//
// Runs on the SERVER, so a link pasted into Instagram, WhatsApp or X
// unfurls into the artist's name, their genres and their photo rather
// than the app shell's generic card. Read with the ANON key under RLS,
// which is what makes this safe: `profiles_select_public_artists` exposes
// artist rows and nothing else, so a viewer-role account's profile
// cannot leak a name through a share card, and neither can a closed one.
async function fetchPublicArtist(id) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key);
    // select('*') so `deactivated_at` can be read before its migration
    // has run — naming it would 400 the query rather than returning null.
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .eq('role', 'artist')
      .maybeSingle();
    if (!data) return null;
    // A closed account has no storefront, so it has no share card either.
    if (data.deactivated_at) return null;
    return data;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const artist = await fetchPublicArtist(params.id);
  if (!artist) {
    return { title: 'Profile · Loudentify' };
  }

  const name = artist.display_name || artist.username || 'Artist';
  const title = `${name} · Loudentify`;
  const genres = (artist.genres || []).join(' · ');
  // The artist's own words first. A bio they wrote is a better card than
  // anything generated from their genre list, and the genre list is the
  // fallback rather than the lead.
  const description =
    (artist.bio && artist.bio.trim())
      ? artist.bio.trim().slice(0, 200)
      : genres
        ? `${genres} — live on Loudentify.`
        : `${name} performs live on Loudentify.`;

  const image = artist.avatar_url || null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'profile',
      siteName: 'Loudentify',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      // Only claim a large image when there IS one. Declaring
      // summary_large_image with no image produces a visibly broken card
      // on X, where plain `summary` would have produced a fine one.
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

// ONE route, two modes. The owner gets their console here; everyone else
// gets the storefront at the SAME url. Which one you see is decided by
// who you are, not by which link you followed.
export default function ArtistProfileRoute({ params }) {
  return (
    <main>
      <Suspense fallback={null}>
        <ProfileSurface artistId={params.id} />
      </Suspense>
    </main>
  );
}
