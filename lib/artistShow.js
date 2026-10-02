// lib/artistShow.js — "is this artist allowed to run this show, and which slot are they?"
import 'server-only';
export async function loadOwnedShow(admin, showId, userId) {
  const { data: show } = await admin.from('shows').select('*').eq('id', showId).maybeSingle();
  if (!show) return { error: 'No such show.', status: 404 };
  const slot = show.artist_id === userId ? 'a' : show.artist_b_id === userId ? 'b' : null;
  if (!slot) return { error: 'This is not your show.', status: 403 };
  return { show, slot };
}
