// /show/:id — the public show page (PRD 173: the link artists share) and
// the show screen itself. Open Graph metadata is read server-side with the
// anon key through RLS (shows are public; profiles through public_profiles).
import { createClient } from '@supabase/supabase-js';
import ViewerShell from '../../../components/viewer/ViewerShell';
import ShowScreen from '../../../components/viewer/ShowScreen';

async function readShow(id) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: show } = await sb.from('shows').select('id, title, description, slated_at, performance_mode, artist_id, artist_b_id, cover_url, genre').eq('id', id).maybeSingle();
    if (!show) return null;
    const { data: artists } = await sb.from('public_profiles').select('id, display_name, username').in('id', [show.artist_id, show.artist_b_id].filter(Boolean));
    return { ...show, artist: (artists || []).find((a) => a.id === show.artist_id) || null, artist_b: (artists || []).find((a) => a.id === show.artist_b_id) || null };
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const show = await readShow(params.id);
  if (!show) return { title: 'Show · Loudentify' };
  const who = show.performance_mode === 'versus' ? `${show.artist?.display_name || 'Artist A'} vs ${show.artist_b?.display_name || 'Artist B'}` : show.artist?.display_name || 'An artist';
  const title = `${show.title || 'Live show'} · ${who} · Loudentify`;
  const description = show.description || `${who} live on Loudentify, ${new Date(show.slated_at).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}. Watch free in your browser.`;
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://loudentify.app';
  return {
    title, description,
    openGraph: { title, description, url: `${base}/show/${show.id}`, siteName: 'Loudentify', type: 'video.other', images: [{ url: show.cover_url || `${base}/logo/loudentify-on-dark.png`, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function ShowPage({ params }) {
  return <ViewerShell variant="dark" tabs={false} cookieBanner={false}><ShowScreen showId={params.id} /></ViewerShell>;
}
