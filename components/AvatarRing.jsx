'use client';

// Hexagonal gradient-ring avatar used across the discover/profile pages.
// No real photo assets in this pilot -- shows an initial on a muted fill
// where the design source used <image-slot>, same mock approach as
// ImagePlaceholder.
const HEX_CLIP =
  'polygon(50.00% 0.00%, 59.27% 3.41%, 69.13% 3.81%, 76.39% 10.51%, 85.36% 14.64%, 89.49% 23.61%, 96.19% 30.87%, 96.59% 40.73%, 100.00% 50.00%, 96.59% 59.27%, 96.19% 69.13%, 89.49% 76.39%, 85.36% 85.36%, 76.39% 89.49%, 69.13% 96.19%, 59.27% 96.59%, 50.00% 100.00%, 40.73% 96.59%, 30.87% 96.19%, 23.61% 89.49%, 14.64% 85.36%, 10.51% 76.39%, 3.81% 69.13%, 3.41% 59.27%, 0.00% 50.00%, 3.41% 40.73%, 3.81% 30.87%, 10.51% 23.61%, 14.64% 14.64%, 23.61% 10.51%, 30.87% 3.81%, 40.73% 3.41%)';

export default function AvatarRing({ name, size = 72, ringWidth = 2, gradient = 'linear-gradient(135deg,#2ec4b6,#ff9f1c,#e71d36)' }) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';
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
          {initial}
        </div>
      </div>
    </div>
  );
}
