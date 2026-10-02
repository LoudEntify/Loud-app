'use client';
// components/viewer/WalletScreen.jsx — Wallet (Wallet.dc.html, WebBuyTokens).
// Balance summed from the ledger, history, and on the web only: Get
// tokens. The payment provider is not chosen, so purchase runs in TEST
// MODE through the existing dev provider (app/wallet/checkout) and says so.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/viewerApi';
import { useSession } from '../../lib/useSession';
import { TOKEN_PACKS, formatMinor } from '../../lib/tokens';
import { Skeleton, ErrorState, Empty } from './States';
import { Back, Token, Chevron, Warn } from './Icons';

export default function WalletScreen() {
  const { session, accessToken, loading } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [buying, setBuying] = useState(null);
  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    const r = await api('/api/viewer/wallet', { accessToken });
    if (!r.ok) { setError(r.data?.error || 'Could not load your wallet'); return; }
    setData(r.data);
  }, [accessToken]);
  useEffect(() => { load(); }, [load]);
  async function buy(pack) {
    setBuying(pack.key);
    const r = await api('/api/wallet/checkout', { method: 'POST', accessToken, body: { packKey: pack.key } });
    setBuying(null);
    if (r.ok && r.data?.checkoutUrl) window.location.href = r.data.checkoutUrl;
    else if (r.ok && r.data?.intentId) window.location.href = `/wallet/checkout?intent=${r.data.intentId}`;
    else setError(r.data?.error || 'Could not start a purchase.');
  }
  if (!loading && !session) return <div className="v-screen"><Empty title="Your wallet lives with your account" body="Sign up free to hold tokens and support artists." action="Sign up free" actionHref="/signup?trigger=wallet" /></div>;
  return (
    <div className="v-screen" data-testid="wallet-screen">
      <div className="v-row" style={{ gap: 12 }}><a href="/profile" aria-label="Back" className="v-icon-btn v-btn-ghost-light"><Back /></a><h1 className="v-h1" style={{ fontSize: 30 }}>Wallet</h1></div>
      {error && <ErrorState title="We couldn't load your wallet" body={error} onRetry={load} backHref={null} />}
      <div style={{ padding: 20, borderRadius: 22, background: 'var(--silk-dark)', color: 'var(--porcelain)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="v-kicker" style={{ fontSize: 15, color: 'rgba(253,255,252,0.85)' }}>Your balance</span>
        {data ? <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }} data-testid="wallet-balance">{data.balance} tokens</span> : <Skeleton w={160} h={44} />}
        <span style={{ fontSize: 16, color: 'rgba(253,255,252,0.85)' }}>Use them to support artists during a show.</span>
      </div>
      <div className="v-card-light">
        <a href="/help#tokens" className="v-list-row"><Token /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontSize: 18, fontWeight: 700 }}>How tokens work</span><span className="v-muted" style={{ fontSize: 14 }}>Plain answers, no small print</span></span><Chevron /></a>
        <a href="/settings" className="v-list-row"><Warn /><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontSize: 18, fontWeight: 700 }}>My spending limit</span><span className="v-muted" style={{ fontSize: 14 }}>{data?.spendingLimit ? `${data.spendingLimit} tokens a day` : 'Not set (platform limit applies)'}</span></span><Chevron /></a>
      </div>
      <section className="v-col" style={{ gap: 10 }}>
        <h2 className="v-h2" style={{ fontSize: 20 }}>Get tokens</h2>
        {data?.testMode && <div className="v-error" role="note" style={{ background: 'rgba(255,159,28,0.18)' }}><span style={{ color: 'var(--orange)' }}><Warn /></span><span style={{ fontSize: 15 }}><strong>Test mode.</strong> No payment provider is connected yet, so these purchases are free practice tokens on this environment. Real payments arrive when a provider is chosen.</span></div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {TOKEN_PACKS.map((p) => <button key={p.key} className="v-card-light v-col" style={{ padding: 16, gap: 4, alignItems: 'flex-start', textAlign: 'left' }} onClick={() => buy(p)} disabled={buying != null || !data} data-testid={`pack-${p.key}`}><span style={{ fontSize: 22, fontWeight: 700 }}>{p.tokens}{p.bonus ? ` + ${p.bonus}` : ''} tokens</span><span className="v-muted" style={{ fontSize: 15 }}>{p.label} · {formatMinor(p.amountMinor)}</span><span className="v-btn v-btn-teal" style={{ marginTop: 8, height: 40, fontSize: 15 }}>{buying === p.key ? 'Starting' : data?.testMode ? 'Get (test)' : 'Buy'}</span></button>)}
        </div>
        <span className="v-muted" style={{ fontSize: 14 }}>Tokens are bought on the web only. The phone apps show your balance.</span>
      </section>
      <h2 className="v-h2" style={{ fontSize: 20 }}>History</h2>
      {!data ? <div className="v-card-light"><div className="v-list-row"><Skeleton w={36} h={36} r={18} /><Skeleton w="60%" h={18} /></div></div>
        : data.history.length ? (
          <div className="v-card-light" data-testid="wallet-history">{data.history.map((h) => <div key={h.id} className="v-list-row"><span className="v-icon-btn" style={{ width: 36, height: 36, background: h.amount < 0 ? 'rgba(255,159,28,0.3)' : 'rgba(46,196,182,0.3)' }}><Token size={18} /></span><span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{h.title}</span><span className="v-muted" style={{ fontSize: 14 }}>{h.detail}</span></span><span style={{ fontSize: 17, fontWeight: 700 }}>{h.amount < 0 ? `−${Math.abs(h.amount)}` : `+${h.amount}`}</span></div>)}</div>
        ) : <Empty title="Nothing yet" body="When you support an artist or add tokens, it shows up here." />}
    </div>
  );
}
