'use client';

import { useState, useEffect, useRef } from 'react';
import { getSession, getProfile, updateProfile, uploadAvatar, onAuthStateChange } from '../lib/supabaseAuth';
import AccountDataControls from './AccountDataControls';
import AvatarRing from './AvatarRing';
import GenreSelect from './GenreSelect';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

const inputStyle = { border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '12px 14px', fontSize: 13, color: INK, outline: 'none', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', fontFamily: 'inherit' };

// Accounts & Identity Day 2 -- real profile edit, replacing the old
// mock-only version (hardcoded defaultValues, no-op Save, a client-side
// "upgrade to artist" button that made no sense once role became a real,
// signup-time-only field on the profiles table). The SECURITY (2FA toggle)
// and account-deletion sections from the old mock are removed rather than
// left as decoration now that everything around them is real -- neither
// was ever backed by anything, and leaving them would misleadingly imply
// they now are.
//
// Product decision (fold-in round, after the test sitting started): bio
// and photo are no longer artist-only -- both roles get the full profile
// (display name, genres, bio, photo). Role differences stay strictly
// capability-based (hosting shows, claiming slots, cue-sheet authoring,
// technical director/audio panels), enforced at the API-route/claim level
// -- see app/api/performer/claim-slot/route.js and app/api/cue-sheets/
// route.js's verifyArtistAuth checks, and components/LiveDemo.jsx's
// isMainPerformer gating (only ever true after a claim-slot success) --
// not by hiding form fields here. This file no longer branches on role at
// all for what's editable.
export default function AccountSettings() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [genres, setGenres] = useState([]);
  const [bio, setBio] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const fileInputRef = useRef(null);
  // Viewer -> artist upgrade. Goes through a server route rather than a
  // direct profile update so there is one place to add the checks this
  // will eventually need (terms, age, verification).
  const [upgrading, setUpgrading] = useState(false);
  const [stageName, setStageName] = useState('');
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');

  // Downgrade. Two-step by construction: the consequences are listed and
  // a second, explicit confirm is required. A one-click role flip that
  // silently hides an artist's public work would be indefensible.
  const [downgrading, setDowngrading] = useState(false);
  const [downgradeBusy, setDowngradeBusy] = useState(false);
  const [downgradeError, setDowngradeError] = useState('');

  async function becomeViewer() {
    setDowngradeError('');
    setDowngradeBusy(true);
    try {
      const res = await fetch('/api/profile/become-viewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) { setDowngradeError(body.error || 'Could not switch your account.'); return; }
      window.location.href = '/profile';
    } catch {
      setDowngradeError('Could not switch your account.');
    } finally {
      setDowngradeBusy(false);
    }
  }

  async function becomeArtist() {
    setUpgradeError('');
    if (!stageName.trim()) { setUpgradeError('Pick a stage name.'); return; }
    setUpgradeBusy(true);
    try {
      const res = await fetch('/api/profile/become-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ stage_name: stageName.trim(), genres, bio }),
      });
      const body = await res.json();
      if (!res.ok) { setUpgradeError(body.error || 'Could not upgrade this account.'); return; }
      // Straight to the console they just unlocked -- landing back on a
      // settings page after an upgrade hides the thing that changed.
      window.location.href = `/artist/${session.user.id}`;
    } catch {
      setUpgradeError('Could not upgrade this account.');
    } finally {
      setUpgradeBusy(false);
    }
  }


  useEffect(() => {
    let cancelled = false;
    async function load() {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (s) {
        const { profile: p } = await getProfile(s.user.id);
        if (cancelled) return;
        setProfile(p);
        setDisplayName(p?.display_name || '');
        setGenres(p?.genres || []);
        setBio(p?.bio || '');
        setPhotoUrl(p?.avatar_url || null);
      }
      setLoading(false);
    }
    load();
    return onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
  }, []);

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    setSaveError('');
    setSaveNotice('');
    const fields = { display_name: displayName.trim(), genres, bio: bio.trim() || null };
    const { profile: updated, error } = await updateProfile(fields);
    if (error) {
      setSaveError(error.message || 'Could not save changes.');
    } else {
      setProfile(updated);
      setSaveNotice('Saved.');
    }
    setSaving(false);
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    setSaveError('');
    const { url, error } = await uploadAvatar(file);
    if (error) {
      setSaveError(error.message || 'Photo upload failed.');
      setPhotoUploading(false);
      return;
    }
    // Day 2 test sitting, Finding 4: this second write was previously
    // fire-and-forget with no error check -- a failed persist (e.g. the
    // profiles.avatar_url/photo_url column-name mismatch that caused this
    // exact bug) left the picked image showing locally (optimistic
    // photoUrl state, set below regardless of outcome) while the database
    // silently never got it, with zero signal to the user. Now checked
    // and reverted on failure like every other save path in this file.
    const { error: persistErr } = await updateProfile({ avatar_url: url });
    if (persistErr) {
      setSaveError(persistErr.message || 'Photo saved to storage but could not be linked to your profile.');
    } else {
      setPhotoUrl(url);
    }
    setPhotoUploading(false);
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px' }}>Loading…</div>;
  }

  if (!session) {
    return (
      <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Settings</div>
          <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(1,22,39,0.6)' }}>Sign in to view and edit your profile.</p>
        </div>
      </div>
    );
  }

  const isArtist = profile?.role === 'artist';

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Settings</div>

        <div style={{ marginTop: 24 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>PROFILE INFO</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
            {/* AvatarRing, not a bespoke <img>. Settings having its own
                avatar rendering is what let the rest of the app disagree
                with it -- one component now, so "what my photo looks
                like here" and "what it looks like everywhere else"
                cannot drift apart again. */}
            <AvatarRing src={photoUrl} name={displayName || profile?.username || 'You'} size={64} alt="Your photo" />
            <div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoUploading}
                style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: TEAL, background: 'rgba(46,196,182,0.12)', border: 'none', cursor: photoUploading ? 'default' : 'pointer' }}
              >
                {photoUploading ? 'UPLOADING…' : 'CHANGE PHOTO'}
              </button>
              <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)', marginTop: 6 }}>JPG or PNG, up to 5MB.</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              style={{ flex: 1, ...inputStyle }}
            />
            <input value={session.user.email} disabled style={{ flex: 1, ...inputStyle, opacity: 0.5 }} />
          </div>

          <div style={{ marginTop: 10 }}>
            <GenreSelect value={genres} onChange={setGenres} />
          </div>

          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Bio"
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, resize: 'vertical', ...inputStyle }}
          />

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ marginTop: 12, maxWidth: 220, width: '100%', textAlign: 'center', padding: '13px 0', fontSize: 11, letterSpacing: '0.08em', fontWeight: 700, color: TEAL, background: 'rgba(46,196,182,0.12)', boxShadow: '0 0 12px rgba(46,196,182,0.2)', opacity: saving ? 0.6 : 1, border: 'none', cursor: saving ? 'default' : 'pointer' }}
          >
            {saving ? 'SAVING…' : 'SAVE CHANGES'}
          </button>
          {saveError && <p style={{ marginTop: 8, fontSize: 12, color: '#e71d36' }}>{saveError}</p>}
          {saveNotice && <p style={{ marginTop: 8, fontSize: 12, color: TEAL }}>{saveNotice}</p>}
        </div>

        <div style={{ marginTop: 28 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>ACCOUNT TYPE</span>
          <div style={{ marginTop: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '13px 14px' }}>
            <div style={{ fontSize: 13, color: INK }}>
              Signed in as an <strong>{isArtist ? 'artist' : 'viewer'}</strong> account
            </div>
            {isArtist ? (
              <>
                <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>
                  You have the full artist console on your profile.
                </div>

                {!downgrading ? (
                  <button
                    type="button"
                    onClick={() => setDowngrading(true)}
                    style={{ marginTop: 12, padding: '10px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.6)', background: 'transparent', border: '1px solid rgba(1,22,39,0.2)', cursor: 'pointer' }}
                  >
                    SWITCH TO A VIEWER ACCOUNT
                  </button>
                ) : (
                  <div style={{ marginTop: 12, border: '1px solid rgba(231,29,54,0.4)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Switch to a viewer account?</div>
                    <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'rgba(1,22,39,0.65)', lineHeight: 1.7 }}>
                      <li>Your public recordings become <strong>private</strong>. Nothing is deleted.</li>
                      <li>Any <strong>upcoming shows are cancelled</strong>, and anyone holding a slot is told.</li>
                      <li>Your <strong>wallet balance and history are untouched</strong>.</li>
                      <li>Your stage name, B-roll and cue sheets are <strong>kept</strong>.</li>
                      <li>The artist console disappears from your profile.</li>
                    </ul>
                    <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 10, lineHeight: 1.55 }}>
                      You can switch back any time with Become an artist, and everything returns as you left it.
                    </div>

                    {downgradeError && <div style={{ fontSize: 12, color: '#e71d36', marginTop: 10 }}>{downgradeError}</div>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={becomeViewer}
                        disabled={downgradeBusy}
                        style={{ padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#fdfffc', background: '#e71d36', border: 'none', cursor: downgradeBusy ? 'default' : 'pointer', opacity: downgradeBusy ? 0.6 : 1 }}
                      >
                        {downgradeBusy ? 'SWITCHING…' : 'YES, SWITCH TO VIEWER'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDowngrading(false); setDowngradeError(''); }}
                        style={{ padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.6)', background: 'transparent', border: '1px solid rgba(1,22,39,0.2)', cursor: 'pointer' }}
                      >
                        KEEP MY ARTIST ACCOUNT
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.55)', marginTop: 8, lineHeight: 1.55 }}>
                  Becoming an artist keeps everything you already have — same account, same wallet,
                  same history — and adds scheduling, Kit Check, recordings and B-roll to your profile.
                  It can&apos;t be undone for now.
                </div>

                {!upgrading ? (
                  <button
                    type="button"
                    onClick={() => { setUpgrading(true); setStageName(displayName || ''); }}
                    style={{ marginTop: 12, padding: '10px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: TEAL, background: 'transparent', border: `1px solid ${TEAL}`, cursor: 'pointer' }}
                  >
                    BECOME AN ARTIST
                  </button>
                ) : (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)', fontWeight: 700, marginBottom: 4 }}>STAGE NAME</div>
                      <input
                        value={stageName}
                        onChange={(e) => setStageName(e.target.value)}
                        placeholder="How you appear on stage"
                        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '11px 12px', fontSize: 13, color: INK, outline: 'none', fontFamily: 'inherit' }}
                      />
                      <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)', marginTop: 4 }}>
                        Your handle @{profile?.username || '…'} stays the same — artists and fans share one namespace.
                      </div>
                    </div>

                    {upgradeError && <div style={{ fontSize: 12, color: '#e71d36' }}>{upgradeError}</div>}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={becomeArtist}
                        disabled={upgradeBusy}
                        style={{ padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#fdfffc', background: INK, border: 'none', cursor: upgradeBusy ? 'default' : 'pointer', opacity: upgradeBusy ? 0.6 : 1 }}
                      >
                        {upgradeBusy ? 'UPGRADING…' : 'CONFIRM'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setUpgrading(false); setUpgradeError(''); }}
                        style={{ padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.6)', background: 'transparent', border: '1px solid rgba(1,22,39,0.2)', cursor: 'pointer' }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Data export, session revocation and account closure. Their own
            component because they are the highest-consequence controls in
            the product and should be read together in one file rather
            than found three screens apart in this form. */}
        <AccountDataControls session={session} profile={profile} />

      </div>
    </div>
  );
}
