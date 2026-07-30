'use client';

import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Mock data only -- a single hardcoded replay (no per-video routing yet,
// see RecordedShows.jsx). No sidebar, matching the design source, which
// treats VOD playback as its own full-bleed surface like the live viewer.
// The scrub bar and dual-cam split are static -- there's no real seekable
// media here, just the archived-chat framing.
const COMMENTS = [
  { user: 'kayla_v', text: 'this beat is insane', indent: 0, isReply: false, textColor: PORCELAIN },
  { user: 'dro', text: '"drop the bass NOW"', indent: 18, isReply: true, textColor: TEAL },
  { user: 'mira.wav', text: 'kilo wave camera work is clean', indent: 0, isReply: false, textColor: PORCELAIN },
  { user: 'benji', text: 'go loud lets get it', indent: 0, isReply: false, textColor: PORCELAIN },
  { user: 'wesley', text: '"that transition was crazy"', indent: 18, isReply: true, textColor: TEAL },
];

export default function VODPlayback() {
  return (
    <div style={{ minHeight: '100vh', width: '100%', background: PORCELAIN, display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 460, background: PORCELAIN, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
          <Link href="/shows" style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
            <ArrowLeft size={15} color={INK} />
          </Link>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.5)' }}>REPLAY &middot; VERSUS</span>
            <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.4)', marginTop: 2 }}>Jul 12 &middot; 18.2K views</div>
          </div>
          <div style={{ width: 34 }} />
        </div>

        <div style={{ position: 'relative', display: 'flex', height: 380, padding: '0 8px', gap: 2 }}>
          <div style={{ position: 'relative', height: '100%', width: '50%', overflow: 'hidden', clipPath: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)' }}>
            <ImagePlaceholder label="VIDEO" />
            <div style={{ position: 'absolute', top: 8, left: 10, zIndex: 2, fontSize: 10, letterSpacing: '0.08em', color: INK, background: 'rgba(253,255,252,0.55)', padding: '4px 8px' }}>NEON MERIDIAN</div>
          </div>
          <div style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 2, height: '100%', background: 'rgba(1,22,39,0.25)' }} />
          </div>
          <div style={{ position: 'relative', height: '100%', width: '50%', overflow: 'hidden', clipPath: 'polygon(0 0,100% 0,100% 14px,100% 100%,0 100%)' }}>
            <ImagePlaceholder label="VIDEO" />
            <div style={{ position: 'absolute', top: 8, right: 10, zIndex: 2, fontSize: 10, letterSpacing: '0.08em', color: INK, background: 'rgba(253,255,252,0.55)', padding: '4px 8px' }}>KILO WAVE</div>
          </div>
        </div>

        <div style={{ padding: '14px 16px 6px' }}>
          <div style={{ height: 3, background: 'rgba(1,22,39,0.15)', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '38%', background: TEAL, boxShadow: '0 0 8px rgba(46,196,182,0.5)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.5)' }}>18:22</span>
            <span style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.5)' }}>48:10</span>
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', background: INK, borderTop: '1px solid rgba(1,22,39,0.1)', height: '48vh', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0' }}>
            <div style={{ width: 32, height: 3, background: 'rgba(253,255,252,0.2)' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {COMMENTS.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, paddingLeft: c.indent }}>
                {c.isReply && <div style={{ color: 'rgba(253,255,252,0.35)', fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}>&#8627;</div>}
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: PORCELAIN }}>{c.user}</span>
                  <span style={{ fontSize: 12.5, color: c.textColor, marginLeft: 6 }}>{c.text}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(253,255,252,0.08)', textAlign: 'center' }}>
            <span style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(253,255,252,0.4)' }}>ARCHIVED CHAT &middot; REPLAY ONLY</span>
          </div>
        </div>

      </div>
    </div>
  );
}
