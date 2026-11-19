import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../../lib/rateLimit';
import { youtubeLiveEnabled } from '../../../../../lib/youtubeServer';
import { youtubePlayerExperience } from '../../../../../lib/youtubePlayer.mjs';

const RATE_LIMIT = { limit: 120, windowMs: 60_000 };

// AUTH MODEL: public, read-only viewer lookup. A show link is public and
// unlisted/public YouTube IDs are exactly what its audience needs to embed.
// Private broadcasts never expose their video ID. OAuth and ingestion
// credentials are not selected by this route at all.
export async function GET(request, { params }) {
  const gate = rateLimit(clientKey(request, 'youtube-player'), RATE_LIMIT);
  if (!gate.ok) return NextResponse.json({ status: 'UNAVAILABLE', message: 'Too many requests. Try again shortly.' }, { status: 429 });
  if (!youtubeLiveEnabled()) return NextResponse.json({ status: 'NOT_CONFIGURED' });

  const { id } = await params;
  const admin = getSupabaseAdmin();
  const { data: show, error: showError } = await admin.from('shows').select('id,state,title,room_name').eq('id', id).maybeSingle();
  if (showError || !show) return NextResponse.json({ status: 'NOT_FOUND', message: 'This show is unavailable.' }, { status: 404 });

  const { data, error } = await admin.from('youtube_broadcasts')
    .select('show_id,youtube_broadcast_id,privacy_status,state,watch_url,last_error')
    .eq('show_id', show.id)
    .maybeSingle();
  if (error) return NextResponse.json({ status: 'UNAVAILABLE', message: 'The player could not be loaded.' }, { status: 503 });
  return NextResponse.json(youtubePlayerExperience(show, data));
}
