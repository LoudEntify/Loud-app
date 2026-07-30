'use client';

// Mock stand-in for real media -- this pilot has no image/video asset
// pipeline yet, so thumbnails/covers render as a labeled fill instead
// (mirrors the Claude Design source's <image-slot> component).
export default function ImagePlaceholder({ label = 'IMG', style }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(1,22,39,0.08)',
        color: 'rgba(1,22,39,0.35)',
        fontSize: 10,
        letterSpacing: '0.08em',
        fontWeight: 700,
        ...style,
      }}
    >
      {label}
    </div>
  );
}
