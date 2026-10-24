'use client';
// components/artist/DirectionSettingsScreen.jsx — Direction settings
// (design/DirectionSettings.dc.html): auto director, pace, manual cuts,
// the moves the director can use, Versus switching, what an operator can
// do; plus the two sections added 23 Oct, the transitions the director
// may use and the look. Saved through /api/artist/direction (audited);
// each change saves on its own so nothing is lost if the artist leaves.
// States: loading (skeleton), error (retry), offline (saves wait),
// success (the "Saved" mark), no empty state (defaults are a valid set).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/useSession';
import { api } from '../../lib/viewerApi';
import { TECHNIQUES, PACES, TRANSITION_CHOICES, LOOK_CHOICES, DEFAULT_DIRECTION, normaliseDirection } from '../../lib/direction';
import { ErrorState, Skeleton, useOnline } from '../viewer/States';
import { Back } from '../viewer/Icons';

const SUB = { fontSize: 14, color: 'rgba(1,22,39,0.75)' };
const PACE_LABEL = { calm: 'Calm', balanced: 'Balanced', lively: 'Lively' };
const FAMILY_LABEL = { basic: 'Basic', motion: 'Motion', texture: 'Texture' };

/** The design's switch: 52×32, teal silk when on. */
function Switch({ on, label, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 52, height: 32, flexShrink: 0, boxSizing: 'border-box', padding: 3, borderRadius: 16, border: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: on ? 'linear-gradient(135deg, #2ec4b6 0%, #8fe6dd 48%, #2ec4b6 100%)' : 'rgba(1,22,39,0.18)', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 26, height: 26, borderRadius: 13, background: '#fff', boxShadow: '0 1px 3px rgba(1,22,39,0.3)' }} />
    </button>
  );
}

function Row({ title, hint, children, minHeight = 60 }) {
  return (
    <div className="v-list-row" style={{ minHeight }}>
      <span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>{hint && <span style={SUB}>{hint}</span>}</span>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange, labels = {} }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: 'rgba(1,22,39,0.07)' }}>
      {options.map((o) => {
        const key = typeof o === 'string' ? o : o.key; const disabled = typeof o === 'object' && o.disabled; const on = value === key;
        return <button type="button" key={key} role="radio" aria-checked={on} aria-pressed={on} disabled={disabled} onClick={() => onChange(key)}
          style={{ flex: 1, height: 36, borderRadius: 18, border: on ? '2px solid #011627' : 'none', background: on ? '#fdfffc' : 'transparent', color: disabled ? 'rgba(1,22,39,0.6)' : '#011627', fontSize: 16, fontWeight: on ? 700 : 400, fontFamily: 'inherit' }}>{labels[key] || (typeof o === 'object' ? o.label : key)}</button>;
      })}
    </div>
  );
}

export default function DirectionSettingsScreen() {
  const router = useRouter();
  const { session, profile, loading, accessToken } = useSession();
  const online = useOnline();
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [save, setSave] = useState({ state: 'idle', error: null }); // idle | saving | saved | error
  const timer = useRef(null);
  useEffect(() => { if (!loading && !session) router.replace('/signup?trigger=perform'); }, [loading, session, router]);

  async function load() {
    setLoadError(null);
    const r = await api('/api/artist/direction', { accessToken });
    if (!r.ok) { setLoadError(r.data?.error || 'Could not load your direction settings.'); return; }
    setSettings(normaliseDirection(r.data.settings));
  }
  useEffect(() => { if (accessToken && profile?.role === 'artist') load(); }, [accessToken, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply a change locally at once and save it; the artist is never blocked on the network. */
  function change(fn) {
    setSettings((s) => {
      const next = normaliseDirection(fn(structuredClone(s)));
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        setSave({ state: 'saving', error: null });
        const r = await api('/api/artist/direction', { method: 'PUT', accessToken, body: { settings: next } });
        setSave(r.ok ? { state: 'saved', error: null } : { state: 'error', error: r.data?.error || 'Could not save. Your changes are kept here; try again.' });
      }, 400);
      return next;
    });
  }

  if (loading || (!settings && !loadError)) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={160} h={30} /><Skeleton h={200} /><Skeleton h={300} /></div>;
  if (profile?.role !== 'artist') return <div className="v-screen"><ErrorState title="Direction settings are for artists" body="Become an artist from your profile first." retry={false} backHref="/profile" backLabel="Your profile" /></div>;
  if (loadError) return <div className="v-screen"><ErrorState title="Could not load" body={loadError} onRetry={load} backHref="/settings" backLabel="Back to settings" /></div>;
  const s = settings;
  const toggleTechnique = (k) => (v) => change((d) => { d.techniques[k] = v; return d; });
  const toggleTransition = (k) => (v) => change((d) => { d.transitions = v ? [...d.transitions, k] : d.transitions.filter((x) => x !== k); return d; });

  return (
    <div className="v-screen v-light" data-testid="direction-settings">
      <div className="v-row" style={{ gap: 12 }}>
        <a href="/settings" aria-label="Back" className="v-btn v-btn-ghost-light" style={{ width: 44, height: 44, borderRadius: 22, padding: 0, justifyContent: 'center' }}><Back /></a>
        <h1 className="v-h1" style={{ fontSize: 30, margin: 0, flex: 1 }}>Direction</h1>
        <span role="status" style={{ ...SUB, color: save.state === 'error' ? 'var(--red)' : SUB.color }}>{!online ? 'Offline: changes save when you are back' : save.state === 'saving' ? 'Saving…' : save.state === 'saved' ? 'Saved' : save.state === 'error' ? 'Not saved' : ''}</span>
      </div>
      {save.state === 'error' && <div className="v-error" role="alert"><span style={{ fontSize: 15 }}>{save.error}</span><button className="v-btn v-btn-ghost-light" onClick={() => change((d) => d)}>Try again</button></div>}

      <section className="v-card-light v-col" style={{ gap: 0 }}>
        <Row title="Auto director" hint="Cuts between your cameras for you" minHeight={64}><Switch on={s.autoDirector} label="Auto director" onChange={(v) => change((d) => { d.autoDirector = v; return d; })} /></Row>
        <div className="v-col" style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid rgba(1,22,39,0.08)' }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Pace of cuts</span>
          <Segmented options={PACES} labels={PACE_LABEL} value={s.pace} onChange={(v) => change((d) => { d.pace = v; return d; })} />
        </div>
        <div style={{ borderTop: '1px solid rgba(1,22,39,0.08)' }}><Row title="Show manual cuts" hint="Open the cut panel when a show starts" minHeight={64}><Switch on={s.showManualCuts} label="Show manual cuts" onChange={(v) => change((d) => { d.showManualCuts = v; return d; })} /></Row></div>
      </section>

      <section className="v-card-light v-col" style={{ gap: 0 }}>
        <div className="v-col" style={{ padding: '14px 16px 6px', gap: 2 }}><h2 className="v-h2" style={{ fontSize: 18, margin: 0 }}>Moves the director can use</h2><span style={{ ...SUB, lineHeight: 1.35 }}>Turn off anything that does not suit your act. The director only uses what is on here.</span></div>
        {TECHNIQUES.map((t) => <Row key={t.key} title={t.label} hint={t.hint}><Switch on={s.techniques[t.key]} label={t.label} onChange={toggleTechnique(t.key)} /></Row>)}
      </section>

      <section className="v-card-light v-col" style={{ gap: 0 }}>
        <div className="v-col" style={{ padding: '14px 16px 6px', gap: 2 }}><h2 className="v-h2" style={{ fontSize: 18, margin: 0 }}>Transitions between shots</h2><span style={{ ...SUB, lineHeight: 1.35 }}>Drawn on the broadcast as the picture changes shot. Cut is always on. Fancier ones are used sparingly and never inside the first second of a shot.</span></div>
        {TRANSITION_CHOICES.map((t) => <Row key={t.key} title={t.label} hint={FAMILY_LABEL[t.family]}><Switch on={s.transitions.includes(t.key)} label={t.label} disabled={t.key === 'cut'} onChange={toggleTransition(t.key)} /></Row>)}
      </section>

      <section className="v-card-light v-col" style={{ gap: 8, padding: '12px 16px' }}>
        <h2 className="v-h2" style={{ fontSize: 18, margin: 0 }}>Look</h2>
        <span style={{ ...SUB, lineHeight: 1.35 }}>The grade on your broadcast. Applied where the show is put together, never on your phone, so your recordings keep the camera's own picture. New shows start with this; change it per show from the console.</span>
        <div className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {LOOK_CHOICES.map((l) => <button type="button" key={l.key} className="v-chip v-chip-light" aria-pressed={s.look.lut === l.key} title={l.note} onClick={() => change((d) => { d.look.lut = l.key; return d; })}>{l.label}</button>)}
        </div>
        {s.look.lut !== 'none' && <label className="v-col" style={{ gap: 4 }}><span style={SUB}>Strength {Math.round(s.look.strength * 100)}%</span><input type="range" min={10} max={100} step={5} value={Math.round(s.look.strength * 100)} onChange={(e) => change((d) => { d.look.strength = Number(e.target.value) / 100; return d; })} aria-label="Look strength" /></label>}
      </section>

      <section className="v-card-light v-col" style={{ gap: 8, padding: '12px 16px' }}>
        <h2 className="v-h2" style={{ fontSize: 18, margin: 0 }}>Versus: who picks the featured artist</h2>
        <Segmented options={[{ key: 'artist_a', label: 'Artist A switches' }, { key: 'automatic', label: 'Automatic (later)', disabled: true }]} value={s.versusPicker} onChange={(v) => change((d) => { d.versusPicker = v; return d; })} />
      </section>

      <section className="v-card-light v-col" style={{ gap: 0 }}>
        <div className="v-col" style={{ padding: '14px 16px 6px', gap: 2 }}><h2 className="v-h2" style={{ fontSize: 18, margin: 0 }}>What an operator can do</h2><span style={SUB}>For a second person running your show from a laptop</span></div>
        {[['cut', 'Cut cameras'], ['prompts', 'Push prompts and votes'], ['end', 'End the show']].map(([k, l]) => <Row key={k} title={l} minHeight={52}><Switch on={s.operator[k]} label={`Operator can ${l.toLowerCase()}`} onChange={(v) => change((d) => { d.operator[k] = v; return d; })} /></Row>)}
      </section>
      <button type="button" className="v-btn v-btn-ghost-light" onClick={() => change(() => structuredClone(DEFAULT_DIRECTION))}>Reset to defaults</button>
    </div>
  );
}
