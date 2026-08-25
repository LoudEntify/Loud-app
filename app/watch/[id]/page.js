import { createClient } from '@supabase/supabase-js';
import WatchRecording from '../../../components/WatchRecording';

// Public watch page. This exists so a shared link has something real to
// unfurl into: generateMetadata runs on the SERVER, so Instagram,
// Facebook and X get a proper title/description card instead of the
// app shell's generic one.
//
// Reads with the anon key under RLS, which already exposes exactly the
// recordings an artist has marked public -- so an unlisted recording
// cannot leak a title through a share card.
async function fetchPublicRecording(id) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createClient(url, key);
    // select('*') rather than a column list: this page wants
    // `duration_ms`, which arrives with a hand-run migration, and naming
    // a column before it exists 400s the whole query rather than
    // returning null for it — which would break the share card entirely
    // on an unmigrated database.
    const { data } = await supabase
      .from('recordings')
      .select('*')
      .eq('id', id)
      .eq('visibility', 'public')
      .maybeSingle();
    if (!data) return null;

    // The artist, for the byline and the card image. A separate query
    // rather than a join because `profiles` has its own RLS and the
    // public-artist policy is what makes this readable at all — a join
    // would silently return nothing for a viewer-role owner instead of
    // just omitting the byline.
    let artist = null;
    if (data.artist_id) {
      const { data: p } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', data.artist_id)
        .maybeSingle();
      artist = p || null;
    }
    return { ...data, artist };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const rec = await fetchPublicRecording(params.id);
  if (!rec) {
    // A private or missing recording gets a deliberately empty card. No
    // title, no artist, nothing that would confirm the id names something
    // real — a share card is a public surface, and an unlisted recording
    // must not leak through one.
    return { title: 'Recording · Loudentify' };
  }

  const artistName = rec.artist?.display_name || rec.artist?.username || null;
  const title = artistName ? `${rec.title} — ${artistName} · Loudentify` : `${rec.title} · Loudentify`;
  const recordedOn = rec.recorded_at ? new Date(rec.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const description = [
    artistName ? `${artistName} live on Loudentify` : 'A live performance on Loudentify',
    recordedOn ? `Recorded ${recordedOn}` : null,
  ].filter(Boolean).join(' · ');

  // The card image is the artist's own photo, and ONLY when they have
  // one. There is no branded fallback here on purpose: every unfurler
  // handles a missing og:image gracefully (title and description card),
  // and none of them handle a broken image URL gracefully. An absent
  // image is a worse-looking card; a broken one is a broken card.
  const image = rec.artist?.avatar_url || null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'video.other',
      siteName: 'Loudentify',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function WatchPage({ params }) {
  const rec = await fetchPublicRecording(params.id);
  return (
    <main>
      <WatchRecording recording={rec} recordingId={params.id} />
    </main>
  );
}
