// GET /api/viewer/wallet — balance and history for the signed-in person.
// Balance is summed from the ledger, never stored. History pairs each
// Support with its show and artist so the list reads like the Wallet board.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { requireSession } from '../../../../lib/viewerAuth';
import { readBalance } from '../../../../lib/ledger';
import { getPaymentProvider, devHarnessAllowed } from '../../../../lib/paymentProvider';

export async function GET(request) {
  const cid = correlationFrom(request);
  const session = await requireSession(request);
  if (session.error) return withCorrelation(NextResponse.json({ error: session.error }, { status: session.status }), cid);
  const admin = getSupabaseAdmin();
  const uid = session.user.id;
  const [bal, { data: tx }, { data: supports }] = await Promise.all([
    readBalance(admin, uid),
    admin.from('wallet_transactions').select('id, amount_tokens, kind, description, created_at, metadata').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
    admin.from('support_events').select('id, show_id, to_artist_id, amount_tokens, created_at, entry_group_id').eq('from_user_id', uid).order('created_at', { ascending: false }).limit(50),
  ]);
  const showIds = [...new Set((supports || []).map((s) => s.show_id))];
  const artistIds = [...new Set((supports || []).map((s) => s.to_artist_id))];
  const [{ data: shows }, { data: artists }] = await Promise.all([
    showIds.length ? admin.from('shows').select('id, title').in('id', showIds) : { data: [] },
    artistIds.length ? admin.from('public_profiles').select('id, display_name').in('id', artistIds) : { data: [] },
  ]);
  const showById = new Map((shows || []).map((s) => [s.id, s])); const artistById = new Map((artists || []).map((a) => [a.id, a]));
  const supportByGroup = new Map((supports || []).map((s) => [s.entry_group_id, s]));
  const history = (tx || []).filter((t) => !(t.kind === 'tip_received')).map((t) => {
    const s = supportByGroup.get(t.entry_group_id) || (supports || []).find((x) => t.metadata?.show_id === x.show_id && Math.abs(Date.parse(x.created_at) - Date.parse(t.created_at)) < 5000);
    if (t.kind === 'tip_sent' && s) return { id: t.id, type: 'support', title: `Supported ${artistById.get(s.to_artist_id)?.display_name || 'an artist'}`, detail: `${showById.get(s.show_id)?.title || 'A show'} · ${new Date(t.created_at).toLocaleDateString('en-GB')}`, amount: t.amount_tokens, at: t.created_at };
    if (t.kind === 'purchase' || t.kind === 'purchase_bonus') return { id: t.id, type: 'purchase', title: t.kind === 'purchase_bonus' ? 'Bonus tokens' : 'Tokens added', detail: new Date(t.created_at).toLocaleDateString('en-GB'), amount: t.amount_tokens, at: t.created_at };
    return { id: t.id, type: t.kind, title: t.description || t.kind, detail: new Date(t.created_at).toLocaleDateString('en-GB'), amount: t.amount_tokens, at: t.created_at };
  });
  const provider = getPaymentProvider();
  return withCorrelation(NextResponse.json({ balance: bal.balance, complete: bal.complete, history, spendingLimit: session.profile?.spending_limit_daily_tokens || null, testMode: provider.name !== 'stripe', devHarness: devHarnessAllowed() }), cid);
}
