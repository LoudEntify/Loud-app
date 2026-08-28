'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getSession } from '../lib/supabaseAuth';
import { CURRENCY_SYMBOL, formatMinor, packByKey } from '../lib/tokens';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';
const ORANGE = '#ff9f1c';

// Declared above the component — `npm run check:tdz` treats
// use-before-define as an error (DECISIONS.md §17).
const testBtn = {
  padding: '10px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  color: 'rgba(1,22,39,0.65)', background: 'transparent',
  border: '1px solid rgba(1,22,39,0.2)', borderRadius: 0, cursor: 'pointer',
};


// THE SIMULATED CHECKOUT.
//
// This stands in for a payment provider's hosted page. It is styled to be
// unmistakable — an orange band across the top saying NO MONEY WILL MOVE —
// because the one genuinely dangerous thing a fake checkout can do is be
// mistaken for a real one.
//
// It is also the test console for the webhook, and that is the point.
// Three buttons: pay, replay the same event, and send a tampered
// signature. The first should credit, and the second and third should
// visibly NOT — proving idempotency and signature rejection with the same
// two clicks that prove the happy path.

export default function DevCheckout() {
  const params = useSearchParams();
  const intentId = params?.get('intent') || '';
  const packKey = params?.get('pack') || '';
  const pack = packByKey(packKey);

  const [session, setSession] = useState(undefined);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);

  useEffect(() => {
    getSession().then((s) => setSession(s ?? null));
  }, []);

  const fire = useCallback(async (label, payload) => {
    setBusy(label);
    try {
      const res = await fetch('/api/wallet/dev-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ intentId, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      setLog((prev) => [
        {
          at: new Date().toLocaleTimeString(),
          label,
          status: res.status,
          webhookStatus: body.webhookStatus,
          detail: body.webhookBody || body,
        },
        ...prev,
      ]);
    } catch (err) {
      setLog((prev) => [{ at: new Date().toLocaleTimeString(), label, status: 0, detail: { error: String(err) } }, ...prev]);
    } finally {
      setBusy('');
    }
  }, [session, intentId]);

  if (session === undefined) {
    return <Shell><div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div></Shell>;
  }

  return (
    <Shell>
      <div style={{ background: 'rgba(255,159,28,0.14)', border: `1px solid ${ORANGE}`, padding: '10px 14px', marginBottom: 20 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '0.1em', fontWeight: 700, color: '#8a5200' }}>
          SIMULATED CHECKOUT — NO MONEY WILL MOVE
        </div>
        <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.6)', marginTop: 5, lineHeight: 1.5 }}>
          No payment provider is connected on this deployment, so this page stands in for one. The event it
          sends is genuinely signed and goes through the same verification, idempotency and ledger code a
          real one would.
        </div>
      </div>

      <div style={{ fontSize: 22, fontWeight: 700 }}>{pack ? pack.label : 'Token purchase'}</div>
      {pack && (
        <div style={{ fontSize: 13, color: 'rgba(1,22,39,0.6)', marginTop: 6 }}>
          {pack.tokens.toLocaleString()} tokens
          {pack.bonus > 0 && <> + {pack.bonus.toLocaleString()} bonus</>}
          {' · '}
          <strong style={{ color: INK }}>{formatMinor(pack.amountMinor)}</strong>
        </div>
      )}
      <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.4)', marginTop: 8, wordBreak: 'break-all' }}>
        intent {intentId || '—'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 22, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => fire('pay', {})}
          disabled={!!busy || !intentId}
          style={{ padding: '13px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: PORCELAIN, background: INK, border: 'none', borderRadius: 0, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          {busy === 'pay' ? 'SENDING…' : `PAY ${CURRENCY_SYMBOL}${pack ? formatMinor(pack.amountMinor).replace(CURRENCY_SYMBOL, '') : '0.00'} (SIMULATED)`}
        </button>
        <Link href="/wallet" style={{ padding: '13px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.6)', border: '1px solid rgba(1,22,39,0.18)', textDecoration: 'none' }}>
          CANCEL
        </Link>
      </div>

      {/* The failure tests, kept visually apart from the happy path so
          nobody presses one by accident while demonstrating a purchase. */}
      <div style={{ marginTop: 26, borderTop: '1px solid rgba(1,22,39,0.1)', paddingTop: 16 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.5)' }}>WEBHOOK TESTS</div>
        <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55, maxWidth: 520 }}>
          Press PAY first, then these. <strong>Replay</strong> sends the identical event id again and should
          report <code>duplicate</code> with no second credit. <strong>Tampered signature</strong> should be
          refused outright, and <strong>wrong amount</strong> should be refused by the amount check even
          though its signature is valid.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fire('replay', {})} disabled={!!busy} style={testBtn}>
            {busy === 'replay' ? '…' : 'REPLAY SAME EVENT'}
          </button>
          <button type="button" onClick={() => fire('tampered signature', { tamperSignature: true, eventId: `evt_dev_tamper_${Date.now()}` })} disabled={!!busy} style={testBtn}>
            {busy === 'tampered signature' ? '…' : 'TAMPERED SIGNATURE'}
          </button>
          <button type="button" onClick={() => fire('wrong amount', { tamperAmount: true, eventId: `evt_dev_amount_${Date.now()}` })} disabled={!!busy} style={testBtn}>
            {busy === 'wrong amount' ? '…' : 'WRONG AMOUNT'}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.5)' }}>RESULTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {log.map((entry, i) => {
              const good = entry.webhookStatus === 200 && !entry.detail?.error;
              return (
                <div key={i} style={{ border: `1px solid ${good ? 'rgba(46,196,182,0.4)' : 'rgba(231,29,54,0.4)'}`, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: good ? TEAL : RED }}>
                    {entry.label.toUpperCase()} · HTTP {entry.webhookStatus ?? entry.status} · {entry.at}
                  </div>
                  <pre style={{ margin: '6px 0 0', fontSize: 10.5, color: 'rgba(1,22,39,0.65)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace' }}>
                    {JSON.stringify(entry.detail, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
          <Link href="/wallet" style={{ display: 'inline-block', marginTop: 14, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: TEAL, textDecoration: 'none', border: `1px solid ${TEAL}`, padding: '11px 15px' }}>
            BACK TO WALLET
          </Link>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
