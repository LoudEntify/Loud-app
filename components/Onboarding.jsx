'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check } from '@phosphor-icons/react';
import AvatarRing from './AvatarRing';
import GenreSelect from './GenreSelect';
import { getSession, getProfile, updateProfile, uploadAvatar } from '../lib/supabaseAuth';
import {
  finishOnboarding,
  homeFor,
  loadOnboarding,
  markStep,
  nextStepIndex,
  stepsFor,
} from '../lib/onboarding';
import { fetchFollowedArtistIds, followArtist, suggestedArtists, unfollowArtist } from '../lib/follows';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

const CHAMFER = 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)';
const inputStyle = {
  border: '1px solid rgba(1,22,39,0.15)', background: 'transparent',
  padding: '12px 14px', fontSize: 13, color: INK, outline: 'none',
  clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit',
};

// Declared above the component, not below it. `npm run check:tdz` treats
// use-before-define as an error precisely because a const referenced from
// a render path that runs before its initialiser is the temporal-dead-zone
// crash that took the live page down in a previous round.
const primaryStyle = {
  padding: '13px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: PORCELAIN, background: INK, border: 'none', borderRadius: 0, cursor: 'pointer',
};

const secondaryStyle = {
  padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
  color: TEAL, background: 'transparent', border: `1px solid ${TEAL}`, borderRadius: 0, cursor: 'pointer',
};

// First run, both roles.
//
// The shape of this screen is an argument about what onboarding is for.
// It is not a form to be completed before the product unlocks — the
// product is already unlocked, and every step here says so. It is the
// shortest path from "I just made an account" to "I have done the one
// thing that makes this place work for me": for an artist, a date in the
// diary; for a fan, a reason for Discover to show them anything.
//
// Hence three rules, enforced structurally rather than by good intentions
// (see lib/onboarding.js):
//   * every step can be skipped, with a real control and a plain label;
//   * progress is saved per step, so closing the tab costs nothing;
//   * LEAVE is always in the top right, on every step, and goes to the
//     surface this person actually came for.
//
// The steps that hand off to another part of the app (schedule a show,
// open Kit Check) mark themselves complete BEFORE navigating. An artist
// who goes off to schedule a show has done that step; making them come
// back and press "done" would be asking them to file a report on
// themselves.

export default function Onboarding() {
  const router = useRouter();

  const [session, setSession] = useState(undefined); // undefined = unknown
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Artist identity step
  const [bio, setBio] = useState('');
  const [genres, setGenres] = useState([]);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  // Viewer follow step
  const [suggestions, setSuggestions] = useState(null); // null = loading
  const [following, setFollowing] = useState(new Set());
  const [followsSupported, setFollowsSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s ?? null);
      if (!s?.user) return;
      const { profile: p } = await getProfile(s.user.id);
      if (cancelled) return;
      setProfile(p || null);
      setBio(p?.bio || '');
      setGenres(p?.genres || []);
      setPhotoUrl(p?.avatar_url || null);

      const loaded = await loadOnboarding(s.user.id, p?.role);
      if (cancelled) return;
      setState(loaded);
      // RESUMPTION IS THIS LINE. First step neither done nor skipped;
      // everything else about "remembering where I was" falls out of it.
      const next = nextStepIndex(loaded, stepsFor(p?.role));
      setIndex(next === null ? Math.max(0, stepsFor(p?.role).length - 1) : next);
    })();
    return () => { cancelled = true; };
  }, []);

  const role = profile?.role || state?.role || 'viewer';
  const steps = stepsFor(role);
  const step = steps[Math.min(index, steps.length - 1)];
  const home = homeFor(role, session?.user?.id);

  // Suggestions are fetched when the follow step is reached, not on
  // mount: a fan who skips straight past it should never have caused a
  // query, and the genres they just picked are what makes the list worth
  // showing at all.
  useEffect(() => {
    if (role === 'artist' || step?.key !== 'follow' || suggestions !== null) return;
    let cancelled = false;
    (async () => {
      const [list, followed] = await Promise.all([
        suggestedArtists({ userId: session?.user?.id, genres }),
        fetchFollowedArtistIds(session?.user?.id),
      ]);
      if (cancelled) return;
      setSuggestions(list);
      setFollowing(followed.ids);
      setFollowsSupported(followed.supported);
    })();
    return () => { cancelled = true; };
  }, [role, step, suggestions, session, genres]);

  const advance = useCallback(async (outcome) => {
    if (!session?.user?.id || !step) return;
    const next = await markStep(session.user.id, state, step.key, outcome);
    setState(next);
    if (index + 1 >= steps.length) {
      const finished = await finishOnboarding(session.user.id, next);
      setState(finished);
      router.replace(home);
      return;
    }
    setIndex(index + 1);
  }, [session, state, step, index, steps.length, router, home]);

  // Complete this step AND leave for somewhere else in the app. Used by
  // the hand-off steps — see the note at the top of this file.
  const completeAndGo = useCallback(async (href) => {
    if (!session?.user?.id || !step) return;
    const next = await markStep(session.user.id, state, step.key, 'completed');
    setState(next);
    router.push(href);
  }, [session, state, step, router]);

  async function saveIdentity() {
    setError('');
    setSaving(true);
    try {
      const { error: err } = await updateProfile({ bio: bio.trim() || null, genres });
      if (err) { setError(err.message || 'Could not save that.'); return; }
      await advance('completed');
    } finally {
      setSaving(false);
    }
  }

  async function saveGenres() {
    setError('');
    setSaving(true);
    try {
      const { error: err } = await updateProfile({ genres });
      if (err) { setError(err.message || 'Could not save that.'); return; }
      await advance('completed');
    } finally {
      setSaving(false);
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setPhotoBusy(true);
    const { url, error: upErr } = await uploadAvatar(file);
    if (upErr) {
      setError(upErr.message || 'That photo could not be uploaded.');
      setPhotoBusy(false);
      return;
    }
    // Checked, not fire-and-forget: an upload that lands in storage but
    // never reaches the profile row leaves a photo showing on screen that
    // nobody else will ever see.
    const { error: persistErr } = await updateProfile({ avatar_url: url });
    if (persistErr) setError('Photo uploaded, but it could not be linked to your profile.');
    else setPhotoUrl(url);
    setPhotoBusy(false);
  }

  async function toggleFollow(artist) {
    const id = artist.id;
    const isFollowing = following.has(id);
    // Optimistic: following someone is a low-stakes, instantly reversible
    // act, and a button that waits for a round trip before acknowledging a
    // tap feels broken.
    setFollowing((prev) => {
      const next = new Set(prev);
      if (isFollowing) next.delete(id); else next.add(id);
      return next;
    });
    const res = isFollowing
      ? await unfollowArtist(session.user.id, id)
      : await followArtist(session.user.id, id);
    if (!res.ok) {
      setFollowing((prev) => {
        const next = new Set(prev);
        if (isFollowing) next.add(id); else next.delete(id);
        return next;
      });
      if (res.supported === false) setFollowsSupported(false);
    }
  }

  if (session === undefined || (session && !state)) {
    return <Screen><div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div></Screen>;
  }
  if (!session) {
    return (
      <Screen>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Sign in first</div>
        <p style={{ fontSize: 13, color: 'rgba(1,22,39,0.6)', marginTop: 8 }}>
          This is the setup walkthrough for a new account.
        </p>
        <Link href="/auth" style={{ ...primaryStyle, textDecoration: 'none', display: 'inline-block', marginTop: 14 }}>LOG IN</Link>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* LEAVE, on every step, in the same place. Onboarding is never
          the thing standing between someone and the product. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(1,22,39,0.45)' }}>
            {role === 'artist' ? 'SETTING UP YOUR ARTIST ACCOUNT' : 'SETTING UP YOUR ACCOUNT'}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{step.title}</div>
        </div>
        <Link href={home} style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)', textDecoration: 'none', border: '1px solid rgba(1,22,39,0.15)', padding: '9px 13px' }}>
          DO THIS LATER
        </Link>
      </div>

      {/* Progress. Named steps, not a percentage — a percentage tells you
          how much is left, a name tells you what it is. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        {steps.map((s, i) => {
          const done = (state?.completed || []).includes(s.key);
          const skipped = (state?.skipped || []).includes(s.key);
          const current = i === index;
          return (
            <div
              key={s.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 9.5, letterSpacing: '0.08em', padding: '6px 11px',
                color: current ? TEAL : done ? 'rgba(1,22,39,0.55)' : 'rgba(1,22,39,0.35)',
                border: `1px solid ${current ? TEAL : 'rgba(1,22,39,0.12)'}`,
                borderRadius: 999,
              }}
            >
              {done && <Check size={10} weight="bold" />}
              {s.key.toUpperCase()}{skipped ? ' · SKIPPED' : ''}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 13.5, color: 'rgba(1,22,39,0.6)', marginTop: 16, lineHeight: 1.6, maxWidth: 560 }}>
        {step.blurb}
      </p>

      {error && <div style={{ fontSize: 12, color: RED, marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 20 }}>
        {step.key === 'identity' && (
          <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: CHAMFER, padding: 18, maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* The same AvatarRing every other surface uses, rather
                  than a bespoke <img> here and a placeholder elsewhere —
                  which is exactly how the header ended up showing an
                  initial while Settings showed a photo. */}
              <AvatarRing src={photoUrl} name={profile?.display_name || 'You'} size={68} alt="Your photo" />
              <div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} style={secondaryStyle}>
                  {photoBusy ? 'UPLOADING…' : photoUrl ? 'CHANGE PHOTO' : 'ADD A PHOTO'}
                </button>
                <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)', marginTop: 6 }}>JPG or PNG, up to 5MB.</div>
              </div>
            </div>

            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="What do you play, and what is a show of yours like?"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 16, resize: 'vertical' }}
            />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.45)', fontWeight: 700, marginBottom: 6 }}>GENRES</div>
              <GenreSelect value={genres} onChange={setGenres} />
            </div>

            <Actions onSkip={() => advance('skipped')} onNext={saveIdentity} nextLabel={saving ? 'SAVING…' : 'SAVE AND CONTINUE'} busy={saving} />
          </div>
        )}

        {step.key === 'schedule' && (
          <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: CHAMFER, padding: 18, maxWidth: 560 }}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'rgba(1,22,39,0.65)', lineHeight: 1.8 }}>
              <li>Your show gets its own room, minted when you schedule it.</li>
              <li>A broadcast window opens 30 minutes before, so you can set up without going live.</li>
              <li>Kit Check hands you to the stage 60 seconds before your start time.</li>
            </ul>
            <Actions
              onSkip={() => advance('skipped')}
              onNext={() => completeAndGo('/shows')}
              nextLabel="SCHEDULE MY FIRST SHOW"
            />
          </div>
        )}

        {step.key === 'kitcheck' && (
          <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: CHAMFER, padding: 18, maxWidth: 560 }}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'rgba(1,22,39,0.65)', lineHeight: 1.8 }}>
              <li>Your camera, your sound and your cues, running on your own machine.</li>
              <li>Nothing is transmitted and nothing is billed while you set up.</li>
              <li>Pair extra phones as cameras — they come with you when the show starts.</li>
            </ul>
            <Actions
              onSkip={() => advance('skipped')}
              onNext={() => completeAndGo('/kit-check')}
              nextLabel="OPEN KIT CHECK"
              extra={<button type="button" onClick={() => advance('completed')} style={secondaryStyle}>FINISH SETUP</button>}
            />
          </div>
        )}

        {step.key === 'genres' && (
          <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: CHAMFER, padding: 18, maxWidth: 560 }}>
            <GenreSelect value={genres} onChange={setGenres} />
            <Actions onSkip={() => advance('skipped')} onNext={saveGenres} nextLabel={saving ? 'SAVING…' : 'SAVE AND CONTINUE'} busy={saving} />
          </div>
        )}

        {step.key === 'follow' && (
          <div style={{ maxWidth: 720 }}>
            {!followsSupported && (
              <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginBottom: 12, lineHeight: 1.5 }}>
                Following switches on once the pending database migration is applied. You can carry on — nothing
                else here depends on it.
              </div>
            )}
            {suggestions === null && <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Finding artists…</div>}
            {suggestions !== null && suggestions.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'rgba(1,22,39,0.55)', lineHeight: 1.6 }}>
                There are no artists to suggest yet. This fills up as artists sign up — Discover is the place to check.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {(suggestions || []).map((a) => {
                const isFollowing = following.has(a.id);
                return (
                  <div key={a.id} style={{ border: '1px solid rgba(1,22,39,0.1)', clipPath: CHAMFER, padding: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <AvatarRing src={a.avatar_url} name={a.display_name || a.username || 'Artist'} size={44} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.display_name || a.username || 'Artist'}
                      </div>
                      <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(a.genres || []).join(' · ') || (a.username ? `@${a.username}` : '')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleFollow(a)}
                      style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '7px 11px',
                        color: isFollowing ? 'rgba(1,22,39,0.55)' : TEAL,
                        background: isFollowing ? 'transparent' : 'rgba(46,196,182,0.12)',
                        border: isFollowing ? '1px solid rgba(1,22,39,0.15)' : 'none',
                        borderRadius: 999, cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      {isFollowing ? 'FOLLOWING' : 'FOLLOW'}
                    </button>
                  </div>
                );
              })}
            </div>
            <Actions onSkip={() => advance('skipped')} onNext={() => advance('completed')} nextLabel="CONTINUE" />
          </div>
        )}

        {step.key === 'discover' && (
          <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: CHAMFER, padding: 18, maxWidth: 560 }}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'rgba(1,22,39,0.65)', lineHeight: 1.8 }}>
              <li>Live shows appear at the top of Discover the moment they start.</li>
              <li>Artists you follow are the first ones you will see.</li>
              <li>You can change any of this in Settings, any time.</li>
            </ul>
            <Actions onSkip={() => advance('skipped')} onNext={() => advance('completed')} nextLabel="TAKE ME TO DISCOVER" />
          </div>
        )}
      </div>
    </Screen>
  );
}

// The skip control is a real button with a plain word on it, sitting
// beside the primary action at the same size. It is not a grey link in a
// corner. Someone who does not want to do this step has given us an
// answer, and the interface should not make them feel they are getting
// away with something.
function Actions({ onSkip, onNext, nextLabel, busy = false, extra = null }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
      <button type="button" onClick={onNext} disabled={busy} style={{ ...primaryStyle, opacity: busy ? 0.6 : 1 }}>
        {nextLabel}
      </button>
      {extra}
      <button
        type="button"
        onClick={onSkip}
        style={{ padding: '13px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.6)', background: 'transparent', border: '1px solid rgba(1,22,39,0.18)', borderRadius: 0, cursor: 'pointer' }}
      >
        SKIP THIS STEP
      </button>
    </div>
  );
}

function Screen({ children }) {
  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
