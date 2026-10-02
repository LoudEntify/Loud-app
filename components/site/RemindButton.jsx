'use client';
// "Remind me" on the public schedule. Guests go to sign-up with the
// trigger recorded (PRD: instrumentation); signed-in people get the row
// in show_reminders through RLS, the same as the app's Live tab.
import { useEffect, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { track } from '../../lib/telemetry';
import { Bell } from '../viewer/Icons';

export default function RemindButton({ showId, next = '/whats-on' }) {
  const { session, loading } = useSession();
  const [set, setSet] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session) return;
    getSupabase().from('show_reminders').select('show_id').eq('user_id', session.user.id).eq('show_id', showId).maybeSingle().then(({ data }) => setSet(Boolean(data)));
  }, [session, showId]);
  async function toggle() {
    if (!session) { window.location.href = `/signup?trigger=remind&next=${encodeURIComponent(next)}`; return; }
    setBusy(true);
    const sb = getSupabase();
    if (set) await sb.from('show_reminders').delete().eq('user_id', session.user.id).eq('show_id', showId);
    else { await sb.from('show_reminders').insert({ user_id: session.user.id, show_id: showId }); track('reminder.set', { from: 'website' }, { showId }); }
    setSet(!set); setBusy(false);
  }
  return (
    <button className="w-chip" aria-pressed={set} onClick={toggle} disabled={busy || loading} data-testid="remind">
      <Bell size={18} /> {set ? 'Reminder set' : 'Remind me'}
    </button>
  );
}
