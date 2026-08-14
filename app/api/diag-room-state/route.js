import { RoomServiceClient } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

// TEMPORARY -- Stage 6 real-recording-test prep. Delete once done.
export const dynamic = 'force-dynamic';

function toHttpUrl(wsUrl) {
  return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

export async function GET() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  const svc = new RoomServiceClient(toHttpUrl(livekitUrl), apiKey, apiSecret);
  let participants = [];
  try {
    participants = await svc.listParticipants('pilot-room');
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
  const admin = getSupabaseAdmin();
  const { data: show } = await admin.from('shows').select('*').eq('room_name', 'pilot-room').maybeSingle();
  const { data: slots } = await admin.from('show_slots').select('*').eq('show_id', show?.id);
  return NextResponse.json({
    participants: participants.map((p) => ({
      identity: p.identity,
      tracks: p.tracks?.map((t) => ({ source: t.source, type: t.type, muted: t.muted })),
    })),
    show,
    slots,
  });
}
