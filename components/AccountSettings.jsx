'use client';

import { useState, useEffect, useRef } from 'react';
import { getSession, getProfile, updateProfile, uploadAvatar, onAuthStateChange } from '../lib/supabaseAuth';
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
            <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', background: 'rgba(1,22,39,0.08)', flexShrink: 0 }}>
              {photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
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
            <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>
              Account type is set at signup and can&apos;t be changed here.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
