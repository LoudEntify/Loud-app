import Logo, { MIN_LEGIBLE_HEIGHT, LOGO_ASPECT } from '../../components/Logo';

export const metadata = {
  title: 'Logo placements · Loudentify',
  description: 'Every logo placement at its real size on its real background.',
};

// /logo-preview — a review surface, not a product page.
//
// Eight placements across six files. Checking them means walking six
// screens, three of which need a live show or a paired phone to reach at
// all. This puts all of them on one page at their real heights on their
// real backgrounds, so contrast and legibility are one pass.
//
// It is a static page with no data access and nothing to break. Delete
// it after the 27th, or keep it — it is how the animated version gets
// checked against the static one later.

const INK = '#011627';
const PORCELAIN = '#fdfffc';

const PLACEMENTS = [
  { n: 1, file: 'HomeDoors.jsx', where: 'Landing page — primary', surface: 'dark', bg: INK, height: 60 },
  { n: 2, file: 'Sidebar.jsx', where: 'Sidebar title (artist dashboard chrome)', surface: 'dark', bg: INK, height: 28 },
  { n: 6, file: 'CamPair.jsx:257', where: 'Pair a camera — code screen', surface: 'dark', bg: INK, height: 24 },
  { n: 7, file: 'CamPair.jsx:269', where: 'Pair a camera — waiting', surface: 'dark', bg: INK, height: 24 },
  { n: 8, file: 'CamPair.jsx:281', where: 'Pair a camera — paired', surface: 'dark', bg: INK, height: 24 },
  { n: 9, file: 'CamPair.jsx:325', where: 'Pair a camera — error', surface: 'dark', bg: INK, height: 24 },
  { n: 10, file: 'CamPage.jsx:277', where: 'Camera viewfinder header', surface: 'dark', bg: INK, height: 24 },
  { n: 11, file: 'Auth.jsx:246', where: 'Artist log in', surface: 'light', bg: PORCELAIN, height: 36 },
];

function Row({ p }) {
  const onDark = p.surface === 'dark';
  return (
    <div style={{ border: '1px solid rgba(1,22,39,0.12)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ padding: '8px 12px', background: 'rgba(1,22,39,0.04)', fontSize: 12, color: 'rgba(1,22,39,0.75)' }}>
        <strong>{p.n}.</strong> {p.where} — <code>{p.file}</code>
        <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {p.height}px · {p.surface === 'dark' ? 'porcelain on ink' : 'ink on porcelain'}
        </span>
      </div>
      <div style={{ background: p.bg, padding: 22, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Logo surface={p.surface} height={p.height} />
        <span style={{ fontSize: 11, color: onDark ? 'rgba(253,255,252,0.45)' : 'rgba(1,22,39,0.45)' }}>
          renders {Math.round(p.height * LOGO_ASPECT)}×{p.height}
        </span>
      </div>
    </div>
  );
}

export default function LogoPreviewPage() {
  return (
    <main style={{ background: PORCELAIN, color: INK, minHeight: '100vh', padding: '28px 20px', fontFamily: 'var(--font-app), system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Logo placements</h1>
        <p style={{ fontSize: 13, color: 'rgba(1,22,39,0.6)', marginTop: 0, lineHeight: 1.5 }}>
          Every placement at its real height on its real background. Eight instances.
          LiveDemo.jsx is deliberately excluded — the live show path is frozen until after the 27th.
        </p>

        {/* The legibility question, answered by looking. */}
        <div style={{ border: '1px solid rgba(231,29,54,0.35)', borderRadius: 10, overflow: 'hidden', margin: '22px 0' }}>
          <div style={{ padding: '8px 12px', background: 'rgba(231,29,54,0.08)', fontSize: 12 }}>
            <strong>The floor.</strong> Minimum legible height is <strong>{MIN_LEGIBLE_HEIGHT}px</strong>.
            The original 14px is shown for comparison — the whale is the thing that fails first.
          </div>
          <div style={{ background: INK, padding: 22, display: 'flex', alignItems: 'flex-end', gap: 26, flexWrap: 'wrap' }}>
            {[14, 20, 24, 28, 36, 60].map((h) => (
              <div key={h} style={{ textAlign: 'center' }}>
                {/* height below the floor is clamped by Logo, so this
                    bypasses the component to show what was rejected. */}
                {h < MIN_LEGIBLE_HEIGHT ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ height: h, width: 'auto', display: 'block' }} />
                ) : (
                  <Logo surface="dark" height={h} />
                )}
                <div style={{ fontSize: 10, color: h < MIN_LEGIBLE_HEIGHT ? '#e71d36' : 'rgba(253,255,252,0.5)', marginTop: 8 }}>
                  {h}px{h < MIN_LEGIBLE_HEIGHT ? ' ✗' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        {PLACEMENTS.map((p) => <Row key={`${p.n}-${p.file}`} p={p} />)}

        {/* Contrast check: each file on the wrong background, so the
            rule is visibly a rule and not a preference. */}
        <div style={{ border: '1px solid rgba(1,22,39,0.12)', borderRadius: 10, overflow: 'hidden', marginTop: 22 }}>
          <div style={{ padding: '8px 12px', background: 'rgba(1,22,39,0.04)', fontSize: 12 }}>
            <strong>Why the pairing matters.</strong> Each file on the background it must never be used on.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', background: INK, padding: 22 }}>
              <Logo surface="light" height={36} />
              <div style={{ fontSize: 10, color: 'rgba(253,255,252,0.5)', marginTop: 8 }}>ink on ink — wrong</div>
            </div>
            <div style={{ flex: '1 1 240px', background: PORCELAIN, padding: 22, borderLeft: '1px solid rgba(1,22,39,0.1)' }}>
              <Logo surface="dark" height={36} />
              <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 8 }}>porcelain on porcelain — wrong</div>
            </div>
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'rgba(1,22,39,0.5)', marginTop: 22, lineHeight: 1.6 }}>
          Both files are 1168×256 with a transparent background, trimmed to the artwork so height
          means the height of the mark rather than the height of its padding. The porcelain version is
          DERIVED from the ink artwork — see the commit message.
        </p>
      </div>
    </main>
  );
}
