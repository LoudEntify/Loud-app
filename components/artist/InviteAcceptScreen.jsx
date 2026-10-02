'use client';
// components/artist/InviteAcceptScreen.jsx — VersusInvite.dc.html.
import { useEffect, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { api } from '../../lib/viewerApi';
import { Skeleton, ErrorState } from '../viewer/States';

export default function InviteAcceptScreen({ token }) {
  const { session, accessToken, loading } = useSession();
  const [invite, setInvite] = useState(null); const [err, setErr] = useState(null); const [done, setDone] = useState(null);
  useEffect(() => { if (accessToken) api(`/api/performer/invite?token=${encodeURIComponent(token)}`, { accessToken }).then((r) => (r.ok ? setInvite(r.data) : setErr(r.data?.error || 'This invite is not valid.'))); }, [accessToken, token]);
  useEffect(() => { if (!loading && !session) window.location.href = `/login?next=${encodeURIComponent(`/artist/invite/${token}`)}`; }, [loading, session, token]);
  async function accept() {
    const r = await api('/api/artist/invite/accept', { method: 'POST', accessToken, body: { token } });
    if (!r.ok) { setErr(r.data?.error || 'Could not accept.'); return; }
    setDone('accepted');
  }
  if (loading || (!invite && !err)) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton h={120} /></div>;
  if (err) return <div className="v-screen"><ErrorState title="We couldn't open this invite" body={err} retry={false} backHref="/notifications" backLabel="Inbox" /></div>;
  const show = { id: invite.showId, title: invite.title, slated_at: invite.slatedAt, duration_minutes: invite.durationMinutes || 45, genre: invite.genre || null, artist_name: invite.hostName };
  return (
    <div className="v-screen v-dark" style={{ background: 'var(--silk-dark)', color: 'var(--porcelain)' }} data-testid="invite">
      <img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ height: 26 }} />
      <div className="v-row" style={{ gap: 10, alignItems: 'center' }}><span className="v-badge v-badge-vs">VS</span><span>You</span></div>
      <h1 style={{ fontSize: 30, lineHeight: 1.1 }}>{show.artist_name || 'An artist'} invited you to a Versus show</h1>
      <section className="v-panel-dark v-col" style={{ padding: 14, gap: 4 }}><span style={{ fontSize: 18, fontWeight: 700 }}>{show.title}</span><span>{new Date(show.slated_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span>{show.duration_minutes} minutes{show.genre ? ` · ${show.genre}` : ''}</span></section>
      <section className="v-col" style={{ gap: 4 }}><h2 className="v-h2" style={{ fontSize: 18 }}>How Versus works</h2><p style={{ fontSize: 15, lineHeight: 1.4 }}>You take turns in the spotlight while the other waits in the corner. Fans get one vote each and can change it until voting closes. The show streams to both your channels.</p></section>
      <span className="v-muted" style={{ fontSize: 14 }}>You get the same reminders as for your own shows.</span>
      {done ? <div className="v-panel-dark" style={{ padding: 14 }}>Accepted. <a className="v-link" href={`/artist/kit-check?show=${show.id}`}>Run Kit Check before the show.</a></div> : <div className="v-row" style={{ gap: 8 }}><a className="v-btn v-btn-lg v-btn-ghost-dark" style={{ flex: 1 }} href="/notifications">Decline</a><button className="v-btn v-btn-lg v-btn-teal" style={{ flex: 1 }} onClick={accept} data-testid="accept-invite">Accept</button></div>}
    </div>
  );
}
