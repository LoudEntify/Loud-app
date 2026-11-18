import { Suspense } from 'react';
import PageShell from '../../components/PageShell';
import RequireAuth from '../../components/RequireAuth';
import ScheduleShow from '../../components/ScheduleShow';

export const metadata = {
  title: 'Schedule a Show | Loudentify',
  description: 'Plan your next Loudentify performance.',
};

export default function SchedulePage() {
  return (
    <PageShell active="schedule">
      <RequireAuth signInPath="/auth/artist">
        <div style={{ minHeight: '100vh', background: '#fdfffc', color: '#011627', padding: '42px 32px 72px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <span style={{ color: '#2ec4b6', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em' }}>ARTIST STUDIO · SCHEDULE</span>
            <h1 style={{ margin: '10px 0 8px', fontSize: 'clamp(34px, 6vw, 64px)', lineHeight: 0.95, letterSpacing: '-0.045em' }}>Put your next<br />show on the calendar.</h1>
            <p style={{ maxWidth: 570, margin: '0 0 30px', color: 'rgba(1,22,39,0.62)', lineHeight: 1.65, fontSize: 14 }}>Choose when you perform, how long the room stays open and whether it is a solo or versus show. Kit Check remains available before your live window opens.</p>
            <Suspense fallback={null}>
              <ScheduleShow />
            </Suspense>
          </div>
        </div>
      </RequireAuth>
    </PageShell>
  );
}
