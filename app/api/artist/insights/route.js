// GET /api/artist/insights[?show=] — per-show insights for the artist (PRD 134).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

export async function GET(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const { data: rows } = await admin.from('show_insights').select('*, shows!inner(title, slated_at, actual_started_at, actual_ended_at)').eq('artist_id', auth.user.id).order('computed_at', { ascending: false }).limit(30);
  return withCorrelation(NextResponse.json({ shows: (rows || []).map((r) => ({ ...r, title: r.shows?.title, slated_at: r.shows?.slated_at, shows: undefined })) }), cid);
}
