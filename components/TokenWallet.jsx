'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';
import { getSession, getProfile } from '../lib/supabaseAuth';
import {
  MIN_CASHOUT_TOKENS,
  TOKEN_PACKS,
  balanceFrom,
  formatMinor,
  payoutMinorFor,
} from '../lib/tokens';
import './reactions.css';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';
const ORANGE = '#ff9f1c';

const CHAMFER = 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)';

// Declared above the component, not below it — `npm run check:tdz` treats
// use-before-define as an error, for the reason given in DECISIONS.md §17.
const cardStyle = {
  marginTop: 12,
  border: '1px solid rgba(1,22,39,0.1)',
  clipPath: CHAMFER,
  padding: '14px 15px',
};

// The wallet — balance, buying, history, and the one door out.
//
// The version this replaces said, honestly, that buying and cashing out
// were not switched on. They are now, and the honesty is kept rather than
// dropped: this page says out loud when it is running against a simulated
// payment provider, because the one genuinely dangerous thing a token
// balance can do is look like it cost real money when it did not.
//
// BALANCE IS STILL SUMMED FROM THE ROWS BENEATH IT, never stored. A stored
// balance and a ledger can disagree, and when they do the person is
// looking at a number nobody can reconstruct.
const KIND_LABEL = {
  tip_received: 'Tip received',
  tip_sent: 'Tip sent',
  purchase: 'Tokens purchased',
  purchase_bonus: 'Bonus tokens',
  payout: 'Payout',
  adjustment: 'Adjustment',
  reaction_spend: 'Reaction',
  vote_spend: 'Competition vote',
  cashout_request: 'Cash-out requested',
  cashout_paid: 'Cash-out paid',
  cashout_reversed: 'Cash-out returned',
  refund: 'Refund',
};

const KYC_COPY = {
  none: {
    title: 'Cash-outs need an identity check',
    body: 'Before money can leave the platform we have to confirm who is receiving it. The check is not built into the app yet — contact support and we will start one for you.',
  },
  pending: {
    title: 'Your identity check is being reviewed',
    body: 'You can request a cash-out as soon as it is done. Nothing else about your account is affected while you wait.',
  },
  rejected: {
    title: 'Your identity check was not accepted',
    body: 'Cash-outs stay closed until this is resolved. Contact support — it is usually a document that could not be read.',
  },
  verified: null,
};

export default function TokenWallet() {
  const params = useSearchParams();
  const purchaseState = params?.get('purchase') || '';

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [transactions, setTransactions] = useState(null); // null = loading

  const [buyBusy, setBuyBusy] = useState('');
  const [buyError, setBuyError] = useState('');
  const [providerInfo, setProviderInfo] = useState(null);
  // Null (not yet known) is deliberately NOT "off": a slow or failed
  // status probe must not silently take the shop down.
  const paymentsOff = providerInfo ? !providerInfo.live : false;

  const [cashout, setCashout] = useState(null); // server view of the cash-out section
  const [cashoutAmount, setCashoutAmount] = useState('');
  const [cashoutBusy, setCashoutBusy] = useState(false);
  const [cashoutError, setCashoutError] = useState('');
  const [cashoutNotice, setCashoutNotice] = useState('');

  const loadTransactions = useCallback(async (userId) => {
    try {
      const { data, error } = await getSupabase()
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      setTransactions(error ? [] : (data || []));
    } catch {
      setTransactions([]);
    }
  }, []);

  const loadCashout = useCallback(async (accessToken) => {
    try {
      const res = await fetch('/api/wallet/cashout', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) { setCashout(null); return; }
      setCashout(await res.json());
    } catch {
      setCashout(null);
    }
  }, []);

  // TASK 4 — ask the SERVER whether a purchase can complete here, before
  // offering one. Previously `providerInfo` was only populated as a side
  // effect of a checkout attempt, so the only way to discover that
  // payments were not connected was to try and fail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSession();
        const token = s?.access_token;
        if (!token) return;
        const res = await fetch('/api/wallet/provider', { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setProviderInfo(body);
      } catch {
        // Leave providerInfo null. The button stays enabled and a failed
        // checkout still reports honestly — refusing to sell because a
        // status probe hiccuped would be the worse error.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (!s?.user) { setTransactions([]); return; }
      const { profile: p } = await getProfile(s.user.id);
      if (cancelled) return;
      setProfile(p || null);
      await loadTransactions(s.user.id);
      if (p?.role === 'artist' && s.access_token) await loadCashout(s.access_token);
    })();
    return () => { cancelled = true; };
  }, [loadTransactions, loadCashout]);

  // Coming back from a checkout, the credit arrives by WEBHOOK, not by
  // this redirect — the person can be back here before the provider has
  // called us. So the return does not claim success; it refreshes, and
  // says the balance updates as soon as the payment is confirmed. A page
  // that announced "purchased!" and then showed an unchanged balance
  // would be worse than saying nothing.
  useEffect(() => {
    if (purchaseState !== 'complete' || !session?.user?.id) return undefined;
    const timers = [800, 2500, 6000].map((ms) => setTimeout(() => loadTransactions(session.user.id), ms));
    return () => timers.forEach(clearTimeout);
  }, [purchaseState, session, loadTransactions]);

  const buy = useCallback(async (packKey) => {
    setBuyError('');
    setBuyBusy(packKey);
    try {
      const res = await fetch('/api/wallet/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ pack: packKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.checkoutUrl) { setBuyError(body.error || 'Could not start a purchase.'); return; }
      setProviderInfo({ provider: body.provider, live: body.live, testMode: body.testMode });
      window.location.href = body.checkoutUrl;
    } catch {
      setBuyError('Could not start a purchase.');
    } finally {
      setBuyBusy('');
    }
  }, [session]);

  const requestCashout = useCallback(async () => {
    setCashoutError('');
    setCashoutNotice('');
    setCashoutBusy(true);
    try {
      const res = await fetch('/api/wallet/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ tokens: Number(cashoutAmount) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setCashoutError(body.error || 'Could not record your request.'); return; }
      setCashoutNotice('Requested. Your tokens are held until it is settled.');
      setCashoutAmount('');
      await loadTransactions(session.user.id);
      await loadCashout(session.access_token);
    } catch {
      setCashoutError('Could not record your request.');
    } finally {
      setCashoutBusy(false);
    }
  }, [session, cashoutAmount, loadTransactions, loadCashout]);

  const balance = balanceFrom(transactions);
  const isArtist = profile?.role === 'artist';

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ fontSize: 21, fontWeight: 700 }}>Wallet</div>

        {!session && (
          <div style={{ marginTop: 22 }}>
            <EmptyState title="Sign in to see your wallet" action="LOG IN" actionHref="/auth" />
          </div>
        )}

        {session && (
          <>
            {purchaseState === 'complete' && (
              <div style={{ marginTop: 16, border: `1px solid ${TEAL}`, clipPath: CHAMFER, padding: '12px 14px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>Payment sent</div>
                <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 5, lineHeight: 1.5 }}>
                  Your balance updates the moment the payment is confirmed — usually a few seconds. This page is
                  watching for it.
                </div>
              </div>
            )}
            {purchaseState === 'cancelled' && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(1,22,39,0.55)' }}>
                Purchase cancelled. Nothing was charged.
              </div>
            )}

            {/* Balance */}
            <div style={{ marginTop: 20, border: `1px solid ${ORANGE}`, boxShadow: '0 0 14px rgba(255,159,28,0.15)', clipPath: CHAMFER, padding: '20px 22px' }}>
              <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.5)' }}>TOKEN BALANCE</div>
              <div style={{ fontSize: 38, fontWeight: 700, marginTop: 6, lineHeight: 1 }}>
                {transactions === null ? '—' : balance.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.5)', marginTop: 8, lineHeight: 1.5 }}>
                Every token here is the sum of the transactions below, so this number can always be traced back to what caused it.
              </div>
            </div>

            {/* ── Buying ─────────────────────────────────────── */}
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>BUY TOKENS</div>

              {buyError && <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>{buyError}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                {TOKEN_PACKS.map((pack) => (
                  <button
                    key={pack.key}
                    type="button"
                    onClick={() => buy(pack.key)}
                    disabled={!!buyBusy || paymentsOff}
                    title={paymentsOff ? providerInfo?.message || 'Payments are not connected yet.' : undefined}
                    style={{
                      textAlign: 'left', padding: '15px 16px', border: '1px solid rgba(1,22,39,0.12)',
                      clipPath: CHAMFER, background: 'transparent', borderRadius: 0,
                      cursor: (buyBusy || paymentsOff) ? 'default' : 'pointer',
                      opacity: paymentsOff ? 0.4 : (buyBusy && buyBusy !== pack.key ? 0.5 : 1),
                    }}
                  >
                    <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.45)', fontWeight: 700 }}>
                      {pack.label.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: INK }}>
                      {pack.tokens.toLocaleString()}
                    </div>
                    {pack.bonus > 0 && (
                      <div style={{ fontSize: 10, color: TEAL, marginTop: 2 }}>+{pack.bonus.toLocaleString()} bonus</div>
                    )}
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8, color: INK }}>
                      {buyBusy === pack.key ? 'STARTING…' : formatMinor(pack.amountMinor)}
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.45)', marginTop: 10, lineHeight: 1.5 }}>
                {paymentsOff ? (
                  // Short, and it says what is true about the DEPLOYMENT
                  // rather than blaming the person or their card. The
                  // sentence comes from the server (app/api/wallet/provider)
                  // so the copy and the logic that decides it cannot drift.
                  <strong style={{ color: '#8a5200' }}>
                    {providerInfo?.message || 'Payments are not connected yet, so tokens cannot be bought here.'}
                  </strong>
                ) : (
                  <>
                    Payment is taken on the provider&apos;s own secure page. Your card details never reach Loudentify.
                    {providerInfo?.simulated && (
                      <> <strong style={{ color: '#8a5200' }}>{providerInfo.message}</strong></>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ── Cashing out: artists only, KYC-gated ───────── */}
            {isArtist && (
              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>CASHING OUT</div>

                {cashout === null || cashout.available === false ? (
                  <div style={{ ...cardStyle }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>Not available yet</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 5, lineHeight: 1.55 }}>
                      Cash-outs need a pending database update before they can be recorded properly. Your balance is
                      unaffected.
                    </div>
                  </div>
                ) : KYC_COPY[cashout.kycStatus] ? (
                  <div style={{ ...cardStyle }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{KYC_COPY[cashout.kycStatus].title}</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 5, lineHeight: 1.55 }}>
                      {KYC_COPY[cashout.kycStatus].body}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.42)', marginTop: 8 }}>
                      Buying and spending tokens are unaffected — only money leaving the platform needs this.
                    </div>
                  </div>
                ) : (
                  <div style={{ ...cardStyle }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>Request a cash-out</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 5, lineHeight: 1.55 }}>
                      Minimum {MIN_CASHOUT_TOKENS.toLocaleString()} tokens. Your whole balance of{' '}
                      {balance.toLocaleString()} is worth about <strong style={{ color: INK }}>{formatMinor(payoutMinorFor(balance))}</strong>{' '}
                      before fees. The tokens are held as soon as you ask, so they cannot be spent twice.
                    </div>

                    {cashoutError && <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>{cashoutError}</div>}
                    {cashoutNotice && <div style={{ fontSize: 12, color: TEAL, marginTop: 8 }}>{cashoutNotice}</div>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        value={cashoutAmount}
                        onChange={(e) => setCashoutAmount(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder={String(MIN_CASHOUT_TOKENS)}
                        inputMode="numeric"
                        style={{ width: 140, border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '11px 12px', fontSize: 13, color: INK, outline: 'none', fontFamily: 'inherit' }}
                      />
                      <span style={{ fontSize: 11, color: 'rgba(1,22,39,0.5)' }}>
                        ≈ {formatMinor(payoutMinorFor(Number(cashoutAmount) || 0))}
                      </span>
                      <button
                        type="button"
                        onClick={requestCashout}
                        disabled={cashoutBusy || !cashoutAmount}
                        style={{ padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: TEAL, background: 'rgba(46,196,182,0.12)', border: 'none', borderRadius: 0, cursor: cashoutBusy || !cashoutAmount ? 'default' : 'pointer', opacity: cashoutBusy || !cashoutAmount ? 0.5 : 1 }}
                      >
                        {cashoutBusy ? 'REQUESTING…' : 'REQUEST A CASH-OUT'}
                      </button>
                    </div>
                  </div>
                )}

                {(cashout?.requests || []).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                    {cashout.requests.map((r) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5 }}>{Number(r.amount_tokens).toLocaleString()} tokens</div>
                          <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 2 }}>
                            {new Date(r.created_at).toLocaleDateString()} · ≈ {formatMinor(r.amount_minor_estimate, r.currency)}
                          </div>
                        </div>
                        <span style={{ fontSize: 9, letterSpacing: '0.08em', color: r.status === 'paid' ? TEAL : 'rgba(1,22,39,0.5)', border: '1px solid rgba(1,22,39,0.15)', borderRadius: 999, padding: '3px 9px' }}>
                          {String(r.status).toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── History ────────────────────────────────────── */}
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>TRANSACTIONS</div>

              {transactions === null && (
                <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)', marginTop: 12 }}>Loading…</div>
              )}

              {transactions !== null && transactions.length === 0 && (
                <div style={{ marginTop: 12 }}>
                  <EmptyState
                    compact
                    title="No transactions yet"
                    body="Tokens you buy, spend, send or receive appear here, newest first."
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {(transactions || []).map((t) => {
                  const credit = (t.amount_tokens || 0) >= 0;
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: INK }}>{t.description || KIND_LABEL[t.kind] || 'Transaction'}</div>
                        <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>
                          {new Date(t.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {' · '}{KIND_LABEL[t.kind] || t.kind}
                          {t.amount_minor != null && <> · {formatMinor(t.amount_minor, t.currency)}</>}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: credit ? TEAL : 'rgba(1,22,39,0.65)' }}>
                        {credit ? '+' : ''}{(t.amount_tokens || 0).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {(transactions || []).length >= 100 && (
                <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.42)', marginTop: 10 }}>
                  Showing your 100 most recent transactions. Your full history is in a data export (Settings → Your data).
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
