'use client';

import { useState, useEffect } from 'react';
import { getAccountType, setAccountType, onAccountTypeChange } from '../lib/mockAccount';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';

// Mock data only -- editing/saving doesn't reach a real backend, and the
// password-confirm modal just closes on either button. The account-type
// section is the one control here with a real (if entirely local) effect:
// see lib/mockAccount.js.
export default function AccountSettings() {
  const [modalOpen, setModalOpen] = useState(false);
  const [twoFa, setTwoFa] = useState(true);
  const [accountType, setAccountTypeState] = useState('fan');

  useEffect(() => {
    setAccountTypeState(getAccountType());
    return onAccountTypeChange(() => setAccountTypeState(getAccountType()));
  }, []);

  const upgrade = () => setAccountType('artist');

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Settings</div>

        <div style={{ marginTop: 24 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>PROFILE INFO</span>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <input
              defaultValue="Jordan Reyes"
              style={{ flex: 1, border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '12px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' }}
            />
            <input
              defaultValue="jordanreyes@email.com"
              style={{ flex: 1, border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '12px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' }}
            />
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={{ marginTop: 12, maxWidth: 220, width: '100%', textAlign: 'center', padding: '13px 0', fontSize: 11, letterSpacing: '0.08em', fontWeight: 700, color: TEAL, background: 'rgba(46,196,182,0.12)', boxShadow: '0 0 12px rgba(46,196,182,0.2)' }}
          >
            SAVE CHANGES
          </button>
        </div>

        <div style={{ marginTop: 28 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>SECURITY</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '13px 14px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: INK }}>Two-factor authentication for edits</div>
              <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>Require a code before profile changes save</div>
            </div>
            <div
              onClick={() => setTwoFa((v) => !v)}
              style={{ width: 38, height: 20, flexShrink: 0, cursor: 'pointer', position: 'relative', background: twoFa ? 'rgba(46,196,182,0.15)' : 'rgba(1,22,39,0.06)', border: `1px solid ${twoFa ? 'rgba(46,196,182,0.5)' : 'rgba(1,22,39,0.15)'}`, clipPath: 'polygon(4px 0,100% 0,100% 100%,0 100%,0 4px)' }}
            >
              <div style={{ position: 'absolute', top: 2, width: 14, height: 14, background: twoFa ? TEAL : 'rgba(1,22,39,0.4)', left: twoFa ? 20 : 2, transition: 'left 0.2s ease', boxShadow: twoFa ? '0 0 8px rgba(46,196,182,0.6)' : 'none' }} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>ACCOUNT TYPE</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '13px 14px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: INK }}>
                Currently a <strong>{accountType === 'artist' ? 'artist' : 'fan'}</strong> account
              </div>
              <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>
                {accountType === 'artist'
                  ? 'PROFILE in the sidebar takes you to your Artist Dashboard.'
                  : 'Upgrading unlocks the Artist Dashboard and studio tools.'}
              </div>
            </div>
            {accountType !== 'artist' && (
              <button
                type="button"
                onClick={upgrade}
                style={{ flexShrink: 0, padding: '10px 16px', fontSize: 10.5, letterSpacing: '0.06em', fontWeight: 700, color: ORANGE, background: 'rgba(255,159,28,0.12)', boxShadow: '0 0 10px rgba(255,159,28,0.2)' }}
              >
                UPGRADE TO ARTIST ACCOUNT
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(1,22,39,0.08)' }}>
          <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.3)' }}>ACCOUNT</span>
          <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
            <div style={{ fontSize: 12.5, color: 'rgba(1,22,39,0.4)', cursor: 'pointer' }}>Request my data</div>
            <div style={{ fontSize: 12.5, color: 'rgba(1,22,39,0.4)', cursor: 'pointer' }}>Close account</div>
          </div>
        </div>

      </div>

      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(253,255,252,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 10 }}>
          <div style={{ width: '100%', maxWidth: 340, background: PORCELAIN, border: '1px solid rgba(46,196,182,0.4)', boxShadow: '0 0 30px rgba(46,196,182,0.2)', clipPath: 'polygon(16px 0,100% 0,100% 100%,0 100%,0 16px)', padding: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>Confirm your password</div>
            <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.5)', marginTop: 6, lineHeight: 1.5 }}>Re-enter your password to save these changes to your profile.</div>
            <input
              type="password"
              placeholder="Password"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 14, border: '1px solid rgba(1,22,39,0.2)', background: 'transparent', padding: '12px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setModalOpen(false)} style={{ flex: 1, textAlign: 'center', padding: '12px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.6)', background: 'rgba(1,22,39,0.06)' }}>CANCEL</button>
              <button type="button" onClick={() => setModalOpen(false)} style={{ flex: 1, textAlign: 'center', padding: '12px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: PORCELAIN, background: TEAL, boxShadow: '0 0 12px rgba(46,196,182,0.4)' }}>CONFIRM</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
