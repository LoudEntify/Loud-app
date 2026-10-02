// GET /api/artist/earnings — tokens received shown in pounds at the artist
// share recorded at transaction time (PRD 137), pending vs available,
// payout history, identity-check state. Identity and payout providers are
// stubs: cash-out uses the existing /api/wallet/cashout gate.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { readBalance } from '../../../../lib/ledger';
import { payoutMinorFor, MIN_CASHOUT_TOKENS } from '../../../../lib/tokens';

const PENDING_DAYS = 7; // support clears to "available" after a week (chargeback window placeholder until a provider is chosen)
export async function GET(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const uid = auth.user.id;
  const since = new Date(Date.now() - PENDING_DAYS * 86400000).toISOString();
  const [bal, { data: recent }, { data: supports }, { data: cashouts }] = await Promise.all([
    readBalance(admin, uid),
    admin.from('wallet_transactions').select('amount_tokens').eq('user_id', uid).eq('kind', 'tip_received').gte('created_at', since),
    admin.from('support_events').select('id, show_id, from_user_id, amount_tokens, artist_tokens, message, created_at').eq('to_artist_id', uid).order('created_at', { ascending: false }).limit(50),
    admin.from('cashout_requests').select('id, amount_tokens, amount_minor_estimate, status, created_at').eq('artist_id', uid).order('created_at', { ascending: false }).limit(20),
  ]);
  const pendingTokens = (recent || []).reduce((s, r) => s + Number(r.amount_tokens || 0), 0);
  const availableTokens = Math.max(0, bal.balance - pendingTokens);
  const showIds = [...new Set((supports || []).map((s) => s.show_id))];
  const { data: shows } = showIds.length ? await admin.from('shows').select('id, title').in('id', showIds) : { data: [] };
  const byShow = new Map((shows || []).map((s) => [s.id, s.title]));
  const fans = new Map();
  for (const s of supports || []) { const f = fans.get(s.from_user_id) || { tokens: 0, count: 0, last: s.created_at }; f.tokens += s.amount_tokens; f.count += 1; fans.set(s.from_user_id, f); }
  return withCorrelation(NextResponse.json({
    availableMinor: payoutMinorFor(availableTokens), pendingMinor: payoutMinorFor(pendingTokens), availableTokens, pendingTokens, balanceTokens: bal.balance,
    kycStatus: auth.profile.kyc_status || 'none', minimumCashoutTokens: MIN_CASHOUT_TOKENS, payoutAccount: null, identityProvider: 'stub', payoutProvider: 'stub',
    supports: (supports || []).map((s) => ({ ...s, show_title: byShow.get(s.show_id) || null })), fans: [...fans.entries()].map(([id, f]) => ({ fan_id: id, ...f })).sort((a, b) => b.tokens - a.tokens).slice(0, 20),
    cashouts: cashouts || [],
  }), cid);
}
