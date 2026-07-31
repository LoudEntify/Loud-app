'use client';

// components/CameraQRPanel.jsx
// ─────────────────────────────────────────────────────────────
// Artist-side "Add camera" QR panel (SHOW_LIFECYCLE_SPEC.md section 4).
// Three QR codes, one per camera role, each encoding a /cam URL scoped
// to this show's room + this performer's own slot. Generated client-side
// with the qrcode package -- no server round trip, no secret in the URL
// (same trust level as the existing open join screen, per the spec's own
// pilot-honesty note).
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';

const ROLE_OPTIONS = ['wide', 'close', 'side'];

export default function CameraQRPanel({ roomName, slot }) {
  const [dataUrls, setDataUrls] = useState({});

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const links = Object.fromEntries(
    ROLE_OPTIONS.map((r) => [
      r,
      `${origin}/cam?room=${encodeURIComponent(roomName)}&slot=${encodeURIComponent(slot)}&role=${r}`,
    ])
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ROLE_OPTIONS.map(async (r) => [r, await QRCode.toDataURL(links[r], { margin: 1, width: 140 })])
      );
      if (!cancelled) setDataUrls(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName, slot]);

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
      {ROLE_OPTIONS.map((r) => (
        <div key={r} style={{ textAlign: 'center', width: 140 }}>
          {dataUrls[r] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrls[r]} alt={`${r} camera QR code`} width={140} height={140} style={{ display: 'block' }} />
          ) : (
            <div style={{ width: 140, height: 140, background: 'rgba(253, 255, 252, 0.06)' }} />
          )}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginTop: 6, color: '#fdfffc' }}>
            {r.toUpperCase()}
          </div>
          <a
            href={links[r]}
            style={{ fontSize: 9, color: '#2ec4b6', wordBreak: 'break-all', display: 'block', marginTop: 2 }}
          >
            {links[r]}
          </a>
        </div>
      ))}
    </div>
  );
}
