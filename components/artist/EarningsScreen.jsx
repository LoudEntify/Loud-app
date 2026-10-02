'use client';
// components/artist/EarningsScreen.jsx — Wallet and payouts
// (WalletPayouts.dc.html, WebEarnings): earnings in pounds at 72.5%,
// pending and ready, identity check (stub), payout account (provider,
// never us), payout history, fans table (PRD 33–35, 137, 138).
import { useEffect, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { api } from '../../lib/viewerApi';
import { formatMinor } from '../../lib/tokens';
import { Skeleton, ErrorState } from '../viewer/States';
import { Back, Warn, Token, Chevron } from '../viewer/Icons';

export default function EarningsScreen() {
  const { accessToken, loading, profile } = useSession();
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [cash, setCash] = useState(null);
  const load = () => accessToken && api('/api/artist/earnings', { accessToken }).then((r) => (r.ok ? setD(r.data) : setErr(r.data?.error || 'Could not load earnings')));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [accessToken]);
  if (loading || (!d && !err)) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={200} h={30} /><Skeleton h={120} /></div>;
  if (err) return <div className="v-screen"><ErrorState title="We couldn't load your earnings" body={err} onRetry={load} backHref="/profile" backLabel="Your profile" /></div>;
  async function requestCashout() {
    const r = await api('/api/wallet/cashout', { method: 'POST', accessToken, body: { tokens: d.availableTokens } });
    setCash(r.ok ? 'Payout requested. It shows below with its status.' : r.data?.error || 'Could not request a payout.');
    load();
  }
  return (
    <div className="v-screen" data-testid="earnings">
      <div className="v-row" style={{ gap: 12 }}><a href="/profile" aria-label="Back" className="v-icon-btn v-btn-ghost-light"><Back /></a><h1 className="v-h1" style={{ fontSize: 28 }}>Wallet and payouts</h1></div>
      <section style={{ padding: 20, borderRadius: 22, background: 'var(--silk-dark)', color: 'var(--porcelain)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="v-kicker" style={{ color: 'rgba(253,255,252,0.85)' }}>Your earnings</span>
        <div className="v-row" style={{ justifyContent: 'space-between' }}><span>Ready to cash out</span><span style={{ fontSize: 28, fontWeight: 700 }} data-testid="available">{formatMinor(d.availableMinor)}</span></div>
        <div className="v-row" style={{ justifyContent: 'space-between' }}><span>Pending</span><span style={{ fontSize: 20, fontWeight: 700 }}>{formatMinor(d.pendingMinor)}</span></div>
        <span style={{ fontSize: 14, color: 'rgba(253,255,252,0.85)' }}>You keep 72.5% of the tokens fans send you, recorded at the moment they send them.</span>
      </section>
      <section className="v-card-light">
        <div className="v-list-row"><Warn /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>Identity check</span><span className="v-muted" style={{ fontSize: 14 }}>{d.kycStatus === 'verified' ? 'Verified' : d.kycStatus === 'pending' ? 'In review' : 'Not started. Needed before your first cash out. The identity provider is not chosen yet (test stub).'}</span></span></div>
        <div className="v-list-row"><Token /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>Payout account</span><span className="v-muted" style={{ fontSize: 14 }}>Held by our payment provider, never by us</span></span><span className="v-muted">{d.payoutAccount || 'Not added'}</span></div>
        <div className="v-list-row v-muted" style={{ fontSize: 14 }}>Cashing out, the identity check and payout details are done on the web, from a computer or browser.</div>
      </section>
      {d.kycStatus === 'verified' && d.availableTokens >= d.minimumCashoutTokens && <button className="v-btn v-btn-lg v-btn-teal" onClick={requestCashout}>Cash out {formatMinor(d.availableMinor)}</button>}
      {d.kycStatus !== 'verified' && <span className="v-muted" style={{ fontSize: 14 }}>Minimum cash out {d.minimumCashoutTokens} tokens, after the identity check.</span>}
      {cash && <div className="v-card-light" style={{ padding: 12 }}>{cash}</div>}
      <section className="v-card-light"><a href="/wallet" className="v-list-row"><Token /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>Token balance</span><span className="v-muted" style={{ fontSize: 14 }}>For supporting other artists</span></span><span style={{ fontWeight: 700 }}>{d.balanceTokens}</span><Chevron /></a></section>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 20 }}>Fans who supported you</h2>
        {d.fans.length ? <div className="v-card-light">{d.fans.map((f) => <div key={f.fan_id} className="v-list-row"><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>A fan</span><span className="v-muted" style={{ fontSize: 14 }}>{f.count} support{f.count === 1 ? '' : 's'} · last {new Date(f.last).toLocaleDateString('en-GB')}</span></span><span style={{ fontWeight: 700 }}>{f.tokens} tokens</span></div>)}</div> : <span className="v-muted">No support yet. It arrives during your shows.</span>}
      </section>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 20 }}>Payout history</h2>
        {d.cashouts.length ? <div className="v-card-light">{d.cashouts.map((c) => <div key={c.id} className="v-list-row"><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontWeight: 700 }}>{formatMinor(c.amount_minor_estimate)}</span><span className="v-muted" style={{ fontSize: 14 }}>{new Date(c.created_at).toLocaleDateString('en-GB')}</span></span><span className="v-badge v-badge-soon">{c.status}</span></div>)}</div> : <div className="v-card-light v-muted" style={{ padding: 14 }}>No payouts yet. They will show here with their status.</div>}
      </section>
    </div>
  );
}
