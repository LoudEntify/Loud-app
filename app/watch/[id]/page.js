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
    const { data } = await supabase
      .from('recordings')
      .select('id, title, recorded_at, visibility')
      .eq('id', id)
      .eq('visibility', 'public')
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const rec = await fetchPublicRecording(params.id);
  if (!rec) {
    return { title: 'Recording · Loudentify' };
  }
  const title = `${rec.title} · Loudentify`;
  const description = 'Watch this live performance on Loudentify.';
  return {
    title,
    description,
    openGraph: { title, description, type: 'video.other' },
    twitter: { card: 'summary_large_image', title, description },
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
