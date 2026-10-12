// /fans — For fans (design/WebForFans.dc.html).
import SiteShell from '../../components/site/SiteShell';
import { Eye, Bubble, Bars, Coin } from '../../components/site/SiteIcons';
import { PhoneFrame, LiveViewScreen, PosterTile } from '../../components/site/DemoScreens';

export const metadata = { title: 'For fans · Loudentify', description: 'Real artists playing live right now, filmed properly. Watch free, shout in the chat, and vote while it happens.' };

const FEATURES = [
  ['Watch free', 'Every show, no charge. Sign up when you want to join in.', Eye, 'w-disc-teal'],
  ['Be heard', 'Comment while they play. Artists read it and answer live.', Bubble, 'w-disc-orange'],
  ['Vote in the moment', 'Pick the next song, or call a Versus round. One vote each.', Bars, 'w-disc-red'],
  ['Back who you love', 'Send tokens if you want to. Most of it reaches the artist.', Coin, 'w-disc-teal'],
];
// Each tile shows what the line says, with illustrative performer pictures
// (components/site/DemoScreens.jsx): kind, then the picture(s).
const FIND = [
  ['Solo shows', 'One artist, one room, filmed from every angle.', 'live', ['blues.webp']],
  ['Versus', 'Two artists take turns. You decide who moved you.', 'versus', ['punjabi.webp', 'country.webp']],
  ['Recordings', 'Missed it live? Watch it back with the chat in step.', 'recording', ['gospel.webp']],
  ['Competitions', 'Monthly genre rounds, decided by fans. Coming soon.', 'soon', ['arabic.webp']],
];

export default function ForFans() {
  return (
    <SiteShell cta={{ href: '/discover', label: 'Start watching' }}>
      <section className="w-hero" style={{ minHeight: 0 }}>
        <div className="w-hero-text">
          <h1 className="w-h1">Front row, wherever you are</h1>
          <p className="w-lead">Real artists playing live right now, filmed properly. Watch free, shout in the chat, and vote while it happens.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href="/whats-on" className="w-pill w-pill-lg w-pill-teal">See what&rsquo;s live now</a>
            <a href="/get-app" className="w-pill w-pill-lg w-pill-outline">Get the app</a>
          </div>
          <span className="w-note">No account needed to start. No ads in the middle of a song.</span>
        </div>
        <div className="w-hero-art" aria-hidden="true" style={{ '--art-h': '560px' }}>
          {/* the viewer's live view, as the app draws it, around an illustrative performer */}
          <PhoneFrame width={230} left="30%" top={10} testid="fans-phone" illustrative><LiveViewScreen file="k-pop.webp" lazy={false} /></PhoneFrame>
          <span className="w-bubble w-bubble-bl" style={{ left: 0, top: 120 }}>she&rsquo;s on fire tonight</span>
          <span className="w-bubble w-bubble-teal w-bubble-br" style={{ right: 0, top: 240 }}>vote for the ballad</span>
        </div>
      </section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-grid w-grid-4">
        {FEATURES.map(([h, p, Icon, disc]) => (
          <div key={h} className="w-card" style={{ padding: 26 }}><span className={`w-disc ${disc}`} style={{ width: 52, height: 52 }}><Icon size={24} /></span><h2 className="w-h3" style={{ fontSize: 22 }}>{h}</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>{p}</p></div>
        ))}
      </div></section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-dark" style={{ padding: 56, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 className="w-h2">What you&rsquo;ll find</h2>
        <div className="w-grid w-grid-4">
          {FIND.map(([h, p, kind, files]) => (
            <div key={h} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><PosterTile kind={kind} files={files} /><strong style={{ fontSize: 19 }}>{h}</strong><span style={{ fontSize: 16, opacity: .85 }}>{p}</span></div>
          ))}
        </div>
        <span className="w-illus" style={{ alignSelf: 'flex-start' }}>Illustrative images</span>
      </div></section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-banner w-banner-orange">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2 className="w-h2">Something is live right now</h2><p className="w-lead">Open Loudentify and start watching. No account needed.</p></div>
        <a href="/discover" className="w-pill w-pill-lg w-pill-ink">Start watching</a>
      </div></section>
    </SiteShell>
  );
}
