'use client';

import { useState } from 'react';

// Hexagonal gradient-ring avatar. THE one avatar component.
//
// ── WHY THE HEADER SHOWED "F" WHILE SETTINGS SHOWED THE PHOTO ──
// This component had no image at all. It took a `name` and drew an
// initial, full stop -- a placeholder from the era before photo upload
// existed, left in place after it shipped. Settings rendered its own
// bespoke <img>, so a photo appeared there and nowhere else.
//
// It was never a caching or re-fetch problem, which is what it looked
// like from the outside: the profile header was not showing a stale
// avatar, it had no code path that could show one.
//
// So the fix is not "make the header re-read" -- it is to give the
// SHARED component a `src`, and pass it from every surface. One avatar
// component, one source, everywhere: profile header, fan profile,
// artist storefront, Discover cards, onboarding suggestions, and
// Settings itself.
const HEX_CLIP =
  'polygon(50.00% 0.00%, 59.27% 3.41%, 69.13% 3.81%, 76.39% 10.51%, 85.36% 14.64%, 89.49% 23.61%, 96.19% 30.87%, 96.59% 40.73%, 100.00% 50.00%, 96.59% 59.27%, 96.19% 69.13%, 89.49% 76.39%, 85.36% 85.36%, 76.39% 89.49%, 69.13% 96.19%, 59.27% 96.59%, 50.00% 100.00%, 40.73% 96.59%, 30.87% 96.19%, 23.61% 89.49%, 14.64% 85.36%, 10.51% 76.39%, 3.81% 69.13%, 3.41% 59.27%, 0.00% 50.00%, 3.41% 40.73%, 3.81% 30.87%, 10.51% 23.61%, 14.64% 14.64%, 23.61% 10.51%, 30.87% 3.81%, 40.73% 3.41%)';

export default function AvatarRing({ src, name, size = 72, ringWidth = 2, gradient = 'linear-gradient(135deg,#2ec4b6,#ff9f1c,#e71d36)', alt }) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';
  // A broken image URL must fall back to the initial rather than to the
  // browser's own broken-image glyph, which would look like a bug in a
  // place people look at their own face. `onError` clears the src so the
  // initial takes over.
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  return (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width: size,
        height: size,
        clipPath: HEX_CLIP,
        background: gradient,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: ringWidth,
          clipPath: HEX_CLIP,
          background: '#fdfffc',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: ringWidth,
            clipPath: HEX_CLIP,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(1,22,39,0.06)',
            color: 'rgba(1,22,39,0.4)',
            fontWeight: 700,
            fontSize: size * 0.32,
          }}
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt ?? ''}
              onError={() => setFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            initial
          )}
        </div>
      </div>
    </div>
  );
}
