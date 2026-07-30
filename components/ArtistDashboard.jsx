'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, GearSix } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Mock data only -- the artist studio home. Both SOLO and VERSUS route
// into the existing "/" join flow, same as everywhere else that lacks a
// real per-show broadcast route.
const CLIP_DEFS = [
  { key: 'c1', title: 'Afterglow — full set' },
  { key: 'c2', title: 'Versus highlight vs Kilo Wave' },
  { key: 'c3', title: 'Backstage warmup' },
];

const SUPPORTERS = [
  { rank: '01', name: 'kayla_v', amount: '4,200', tag: 'PAID' },
  { rank: '02', name: 'benji', amount: '3,150', tag: 'PAID' },
  { rank: '03', name: 'mira.wav', amount: '1,980', tag: 'FREE' },
  { rank: '04', name: 'dro', amount: '1,410', tag: 'PAID' },
  { rank: '05', name: 'wesley', amount: '980', tag: 'FREE' },
];

export default function ArtistDashboard() {
  const [clipVis, setClipVis] = useState({ c1: true, c2: true, c3: false });

  const toggleClip = (key) => setClipVis((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(1,22,39,0.5)' }}>STUDIO</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4 }}>Neon Meridian</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/notifications" style={{ width: 38, height: 38, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
              <Bell size={16} color={INK} />
              <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 6px ${RED}` }} />
            </Link>
            <Link href="/settings" style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
              <GearSix size={16} color={INK} />
            </Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', padding: '14px 16px' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)' }}>FOLLOWERS</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: INK, marginTop: 4 }}>84.2K</div>
          </div>
          <div style={{ flex: '1 1 160px', border: '1px solid rgba(255,159,28,0.4)', boxShadow: '0 0 12px rgba(255,159,28,0.15)', clipPath: 'polygon(0 0,100% 0,100% 100%,calc(100% - 8px) 100%,0 100%)', padding: '14px 16px' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(255,159,28,0.8)' }}>TOKENS EARNED</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: INK, marginTop: 4 }}>312K</div>
          </div>
          <div style={{ flex: '1 1 160px', border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%)', padding: '14px 16px' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)' }}>SIGNAL</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: INK, marginTop: 4 }}>8,420</div>
          </div>
        </div>

        <div style={{ marginTop: 26 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>START A SHOW</span>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, maxWidth: 480 }}>
            <Link href="/" style={{ flex: 1, textDecoration: 'none', textAlign: 'center', padding: '16px 0', background: 'rgba(46,196,182,0.12)', boxShadow: '0 0 14px rgba(46,196,182,0.25)', borderRadius: 999 }}>
              <span style={{ fontSize: 12, letterSpacing: '0.1em', fontWeight: 700, color: TEAL }}>SOLO</span>
            </Link>
            <Link href="/" style={{ flex: 1, textDecoration: 'none', textAlign: 'center', padding: '16px 0', background: 'rgba(231,29,54,0.12)', boxShadow: '0 0 14px rgba(231,29,54,0.25)', borderRadius: 999 }}>
              <span style={{ fontSize: 12, letterSpacing: '0.1em', fontWeight: 700, color: RED }}>VERSUS</span>
            </Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 32, marginTop: 30, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>CLIP VISIBILITY</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {CLIP_DEFS.map((clip) => {
                const on = clipVis[clip.key];
                return (
                  <div key={clip.key} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', padding: '9px 12px' }}>
                    <div style={{ width: 44, height: 32, flexShrink: 0, clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)', overflow: 'hidden' }}>
                      <ImagePlaceholder label="Clip" />
                    </div>
                    <div style={{ flex: 1, fontSize: 12.5, color: INK }}>{clip.title}</div>
                    <div
                      onClick={() => toggleClip(clip.key)}
                      style={{ width: 38, height: 20, flexShrink: 0, cursor: 'pointer', position: 'relative', background: on ? 'rgba(46,196,182,0.15)' : 'rgba(1,22,39,0.06)', border: `1px solid ${on ? 'rgba(46,196,182,0.5)' : 'rgba(1,22,39,0.15)'}`, clipPath: 'polygon(4px 0,100% 0,100% 100%,0 100%,0 4px)' }}
                    >
                      <div style={{ position: 'absolute', top: 2, width: 14, height: 14, background: on ? TEAL : 'rgba(1,22,39,0.4)', left: on ? 20 : 2, transition: 'left 0.2s ease', boxShadow: on ? '0 0 8px rgba(46,196,182,0.6)' : 'none' }} />
                    </div>
                    <span style={{ fontSize: 8.5, letterSpacing: '0.06em', color: on ? TEAL : 'rgba(1,22,39,0.4)', width: 34 }}>{on ? 'PUBLIC' : 'PRIVATE'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flex: '1 1 320px' }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>TOP SUPPORTERS</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {SUPPORTERS.map((s) => (
                <div key={s.rank} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid rgba(1,22,39,0.08)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)' }}>
                  <span style={{ fontSize: 11, color: 'rgba(1,22,39,0.4)', width: 16 }}>{s.rank}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: INK }}>{s.name}</span>
                  <span style={{ fontSize: 9, letterSpacing: '0.06em', color: s.tag === 'PAID' ? ORANGE : 'rgba(1,22,39,0.5)', border: `1px solid ${s.tag === 'PAID' ? 'rgba(255,159,28,0.5)' : 'rgba(1,22,39,0.2)'}`, padding: '3px 7px', clipPath: 'polygon(4px 0,100% 0,100% 100%,0 100%,0 4px)' }}>{s.tag}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{s.amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
