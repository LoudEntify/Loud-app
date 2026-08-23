'use client';

import { useEffect, useState } from 'react';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';
import { getSession } from '../lib/supabaseAuth';
import './reactions.css';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';

// Wallet — ledger and UI only. NO money moves in this round.
//
// The mock 1,240-token balance and the three purchase tiers with dollar
// prices are gone. A price tag that cannot be paid is worse than no
// price tag: it invites a fan to try, and there is nothing behind it.
//
// Balance is SUMMED from wallet_transactions rather than stored, so the
// number on this page can always be reconstructed from the rows beneath
// it. See docs/wallet_migration.sql.
const KIND_LABEL = {
  tip_received: 'Tip received',
  tip_sent: 'Tip sent',
  purchase: 'Tokens purchased',
  payout: 'Payout',
  adjustment: 'Adjustment',
};

export default function TokenWallet() {
  const [session, setSession] = useState(null);
  const [transactions, setTransactions] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (!s?.user) { setTransactions([]); return; }
      try {
        const { data, error } = await getSupabase()
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', s.user.id)
          .order('created_at', { ascending: false })
          .limit(100);
        if (cancelled) return;
        setTransactions(error ? [] : (data || []));
      } catch {
        if (!cancelled) setTransactions([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const balance = (transactions || []).reduce((sum, t) => sum + (t.amount_tokens || 0), 0);

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
            {/* Balance */}
            <div style={{ marginTop: 20, border: `1px solid ${ORANGE}`, boxShadow: '0 0 14px rgba(255,159,28,0.15)', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)', padding: '20px 22px' }}>
              <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.5)' }}>TOKEN BALANCE</div>
              <div style={{ fontSize: 38, fontWeight: 700, marginTop: 6, lineHeight: 1 }}>
                {transactions === null ? '—' : balance.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.5)', marginTop: 8, lineHeight: 1.5 }}>
                Every token here is the sum of the transactions below, so this number can always be traced back to what caused it.
              </div>
            </div>

            {/* Honest state of play. This is a product promise, so it is
                stated where the money would be, not buried in a FAQ. */}
            <div style={{ marginTop: 14, border: '1px dashed rgba(1,22,39,0.2)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '14px 16px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Buying and cashing out aren&apos;t switched on yet</div>
              <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 5, lineHeight: 1.55 }}>
                There is no payment provider connected, so nothing here can be topped up or withdrawn. The ledger is real and
                will keep an exact record from the day it can be.
              </div>
            </div>

            {/* History */}
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>TRANSACTIONS</div>

              {transactions === null && (
                <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)', marginTop: 12 }}>Loading…</div>
              )}

              {transactions !== null && transactions.length === 0 && (
                <div style={{ marginTop: 12 }}>
                  <EmptyState
                    compact
                    title="No transactions yet"
                    body="Tips you send or receive during shows will be listed here, newest first."
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
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: credit ? TEAL : 'rgba(1,22,39,0.65)' }}>
                        {credit ? '+' : ''}{(t.amount_tokens || 0).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
