// components/site/DemoScreens.jsx — the app's screens, drawn at phone size
// (390 x 844) with static demo data, for the device frames on the public
// site. Each screen is laid out the way the real component lays it out
// (lib/player/layout.js for the show screen, components/viewer/Discover.jsx
// for the feed, components/artist/ConsoleScreen.jsx for the artist's
// frame) and uses the same viewer.css parts, so nothing here shows a
// control the app does not have. The "video" is a performer picture from
// public/landing/performers (illustrative, labelled as such); the copy is
// neutral: no names, no usernames, no counts.
//
// Server-rendered, no state. A PhoneFrame scales the 390-wide screen with
// a transform to whatever size the page needs, so the proportions are the
// app's own at every size.
import { IMAGES, IMAGE_DIR } from '../landing/tiles';
import { Back, Person, Token, Share, Bigger, Flag, Emoji, Heart, Send, Search, Inbox, Dots, Home, LiveDot, Eye, Play } from '../viewer/Icons';

export const SCREEN_W = 390;
export const SCREEN_H = 844;

export function picture(file) {
  const img = IMAGES.find((i) => i.file === file);
  if (!img) throw new Error(`DemoScreens: no picture ${file} in components/landing/tiles.js`);
  return img;
}

/** The performer picture as the "video" filling a box. */
export function Video({ file, lazy = true, focus, scale = 1, style }) {
  const img = picture(file);
  return (
    <img
      src={`${IMAGE_DIR}${img.file}`}
      width={img.w}
      height={img.h}
      alt=""
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: focus || img.focus, display: 'block', transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: focus || img.focus, ...style }}
    />
  );
}

/** A phone body at a given CSS width (shrunk on narrow screens by the
 *  stylesheet); the children are a 390 x 844 screen. `illustrative` puts
 *  the small label under the phone. */
export function PhoneFrame({ width = 250, left, top, right, bottom, dark = true, style, children, testid, illustrative = false }) {
  const s = width / SCREEN_W;
  return (
    <div className="w-device-wrap" style={{ '--s': s, left, top, right, bottom, ...style }}>
      <div className={`w-device${dark ? ' w-device-dark' : ''}`} data-testid={testid}>
        <div className="w-screen">{children}</div>
      </div>
      {illustrative && <Illustrative />}
    </div>
  );
}

export function Illustrative({ style }) {
  return <span className="w-illus" style={style}>Illustrative</span>;
}

// Neutral chat: no usernames, the same lines the site already uses.
export const DEMO_CHAT = [['Fan', "she's on fire tonight"], ['Fan', 'vote for the ballad']];

const abs = (x, y, w, h, extra = {}) => ({ position: 'absolute', left: x, top: y, width: w, height: h, ...extra });
const iconBtn = (bg = 'rgba(1,22,39,0.55)', color = 'var(--porcelain)') => ({ width: 44, height: 44, borderRadius: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: bg, color });

// ── the viewer's show screen, phone, default mode, live ──────────────
// Geometry from lib/player/layout.js phoneLayout(): header 0..96, player
// 304 x 540 at (12, 104), side column at x 322, card at y 652 (h 56),
// comments from y 714, composer at y 772 (h 48).
export function LiveViewScreen({ file, lazy = true, question = 'What should I play next?', chat = DEMO_CHAT }) {
  return (
    <div className="v-root w-demo-screen" style={{ background: 'var(--silk-dark)' }}>
      <div className="v-row" style={{ ...abs(0, 0, SCREEN_W, 96), gap: 10, padding: '52px 12px 0' }}>
        <span style={iconBtn('rgba(1,22,39,0.5)')}><Back /></span>
        <span className="v-row" style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <span className="v-avatar" style={{ width: 36, height: 36 }}><Person size={20} /></span>
          <span className="v-col" style={{ gap: 3 }}>
            <span style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>Artist</span>
            <span className="v-row" style={{ gap: 8 }}><span className="v-badge v-badge-live">LIVE</span></span>
          </span>
        </span>
        <span className="v-btn v-btn-teal">Follow</span>
      </div>
      <div style={{ ...abs(12, 104, 304, 540), outline: '1px solid rgba(253,255,252,0.28)', background: 'var(--poster)', overflow: 'hidden' }}>
        <Video file={file} lazy={lazy} />
      </div>
      <div style={{ ...abs(322, 104, 56, 236), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {[['Support', Token, true], ['Share', Share], ['Bigger', Bigger], ['Report', Flag]].map(([label, Icon, orange]) => (
          <span key={label} style={{ width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, lineHeight: 1 }}>
            <span style={iconBtn(orange ? 'var(--orange)' : 'rgba(1,22,39,0.55)', orange ? 'var(--ink)' : 'var(--porcelain)')}><Icon /></span><span>{label}</span>
          </span>
        ))}
      </div>
      <div className="v-card-dark v-row" style={{ ...abs(12, 652, 366, 56), padding: '0 6px 0 14px', gap: 10 }}>
        <span className="v-col" style={{ flex: 1, gap: 1 }}><span className="v-kicker" style={{ color: 'var(--teal)' }}>Vote open</span><span className="v-ellipsis" style={{ fontSize: 16, fontWeight: 700 }}>{question}</span></span>
        <span className="v-btn v-btn-teal">Vote</span>
      </div>
      <div style={{ ...abs(12, 714, 366, 52), display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6, fontSize: 16, lineHeight: 1.25, overflow: 'hidden' }}>
        {chat.map(([who, what]) => <div key={what} className="v-ellipsis"><span style={{ fontWeight: 700, color: 'var(--orange)' }}>{who}</span> {what}</div>)}
      </div>
      <div className="v-row" style={{ ...abs(12, 772, 366, 48), gap: 8 }}>
        <span style={iconBtn('rgba(253,255,252,0.16)')}><Emoji /></span>
        <span style={iconBtn('rgba(253,255,252,0.16)')}><Heart /></span>
        <span style={{ flex: 1, height: 48, padding: '0 16px', borderRadius: 24, background: 'rgba(253,255,252,0.16)', color: '#c9cfd1', fontSize: 17, display: 'flex', alignItems: 'center' }}>Say something</span>
        <span style={{ ...iconBtn('var(--silk-teal)', 'var(--ink)'), width: 48, height: 48, borderRadius: 24 }}><Send /></span>
      </div>
    </div>
  );
}
// ── Discover, the app's home: one live card of the feed, phone ──────
// From components/viewer/Discover.jsx FeedCard (first card) and TabBar.
export function DiscoverScreen({ file, genre, lazy = true }) {
  const img = picture(file);
  return (
    <div className="v-root w-demo-screen" style={{ background: 'var(--silk-ink)' }}>
      <div style={{ ...abs(0, 0, SCREEN_W, SCREEN_H), display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: 'min(100%, calc(844px * 9 / 16))', height: '100%', overflow: 'hidden' }}><Video file={file} lazy={lazy} /></div>
      </div>
      <div className="v-feed-fade-top" /><div className="v-feed-fade-bottom" />
      <div className="v-row" style={{ ...abs(0, 0, SCREEN_W, 82), padding: '52px 16px 0', justifyContent: 'space-between' }}>
        <img src="/logo/loudentify-on-dark.png" alt="" width={1168} height={256} style={{ height: 30, width: 'auto' }} loading={lazy ? 'lazy' : 'eager'} />
        <span className="v-row" style={{ gap: 8 }}><span style={iconBtn('rgba(1,22,39,0.5)')}><Search /></span><span style={iconBtn('rgba(1,22,39,0.5)')}><Inbox /></span></span>
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 132, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <span className="v-avatar" style={{ width: 52, height: 52, border: '2px solid var(--porcelain)' }}><Person size={24} /></span>
        {[['Share', Share], ['More', Dots]].map(([label, Icon]) => <span key={label} style={{ width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 13 }}><span style={{ ...iconBtn('rgba(1,22,39,0.5)'), width: 48, height: 48 }}><Icon /></span><span>{label}</span></span>)}
      </div>
      <div style={{ position: 'absolute', left: 16, right: 84, bottom: 104, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="v-row" style={{ gap: 8 }}><span className="v-badge v-badge-live" style={{ padding: '4px 10px', fontSize: 13 }}>LIVE</span></div>
        <span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.05 }}>Artist</span>
        <span style={{ fontSize: 18, lineHeight: 1.25 }}>Live performance</span>
        <div className="v-row" style={{ gap: 8 }}>{(genre || img.label) && <span className="v-chip v-chip-dark" style={{ height: 30, fontSize: 14 }}>{genre || img.label}</span>}<span className="v-chip v-chip-dark" style={{ height: 30, fontSize: 14 }}>Solo show</span></div>
        <span className="v-btn v-btn-lg v-btn-teal" style={{ marginTop: 6 }}>Join the show</span>
      </div>
      <div style={{ ...abs(0, SCREEN_H - 88, SCREEN_W, 88), padding: '8px 8px 0', display: 'flex', alignItems: 'flex-start', background: 'rgba(1,22,39,.82)', borderTop: '1px solid rgba(253,255,252,.1)', color: 'rgba(253,255,252,.72)' }}>
        {[['Discover', Home, true], ['Live', LiveDot], ['Profile', Person]].map(([label, Icon, current]) => (
          <span key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0', fontSize: 13, minHeight: 56, fontWeight: current ? 700 : 400, color: current ? 'var(--porcelain)' : undefined }}>
            <span style={{ display: 'flex', padding: '2px 14px', color: current ? 'var(--teal)' : undefined }}><Icon /></span><span>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── the artist's camera frame: one performer image, two crops ───────
// The console shows the composed frame with LIVE, the elapsed time and the
// delivery state (components/artist/ConsoleScreen.jsx). The camera label
// names which phone this is.
export function CamFeedScreen({ file, cam = 'wide', label, elapsed = '12:40', lazy = true }) {
  const img = picture(file);
  const close = cam === 'close';
  return (
    <div className="v-root w-demo-screen" style={{ background: 'var(--ink)' }}>
      <div style={{ ...abs(0, 0, SCREEN_W, SCREEN_H), overflow: 'hidden' }}>
        <Video file={file} lazy={lazy} focus={close ? img.focus : '50% 50%'} scale={close ? 1.9 : 1} />
      </div>
      <div className="v-row" style={{ ...abs(0, 0, SCREEN_W, 96), padding: '52px 16px 0', justifyContent: 'space-between' }}>
        <span className="v-row" style={{ gap: 8 }}><span className="v-badge v-badge-live">LIVE</span><span style={{ fontSize: 17, fontWeight: 700 }}>{elapsed}</span></span>
        <span className="v-badge v-badge-soon" style={{ background: 'var(--teal)' }}>DELIVERING</span>
      </div>
      <span className="v-kicker" style={{ position: 'absolute', left: 16, bottom: 40, padding: '6px 10px', borderRadius: 999, background: 'rgba(1,22,39,0.72)', fontSize: 12 }}>{label || (close ? 'Cam 2 close' : 'Cam 1 wide')}</span>
    </div>
  );
}

// ── small posters for the "What you'll find" tiles on /fans ─────────
export function PosterTile({ kind, files, height = 220 }) {
  const [a, b] = files;
  return (
    <span className="w-thumb w-poster" style={{ height }} aria-hidden="true">
      {kind === 'versus' ? (
        <span style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          <span style={{ overflow: 'hidden' }}><Video file={a} /></span><span style={{ overflow: 'hidden' }}><Video file={b} /></span>
        </span>
      ) : (
        <span style={{ position: 'absolute', inset: 0, overflow: 'hidden', filter: kind === 'soon' ? 'saturate(.6) brightness(.7)' : undefined }}><Video file={a} /></span>
      )}
      {kind === 'live' && <span className="w-badge w-badge-live">LIVE</span>}
      {kind === 'versus' && <><span className="w-badge w-badge-live">LIVE</span><span className="w-badge w-badge-versus w-badge-right">VERSUS</span></>}
      {kind === 'recording' && <span className="w-poster-centre"><Play size={40} /><span className="v-kicker" style={{ fontSize: 13 }}>Recording</span></span>}
      {kind === 'soon' && <span className="w-badge w-badge-soon">COMING SOON</span>}
    </span>
  );
}
