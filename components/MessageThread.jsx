'use client';

import EmptyState from './EmptyState';

const INK = '#011627';
const PORCELAIN = '#fdfffc';

// Messaging has no backend yet -- no threads table, no delivery, no
// recipients. The hardcoded four-message conversation that used to sit
// here looked like a working inbox, which is worse than an empty one:
// it invites an artist to reply to a fan who does not exist.
//
// Honest empty state until there is something real to render.
export default function MessageThread() {
  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Messages</div>
        <div style={{ marginTop: 22 }}>
          <EmptyState
            title="Messages aren't live yet"
            body="Direct messages between artists and fans are coming. Nothing here is a placeholder for a conversation you actually have."
            action="BACK TO DISCOVER"
            actionHref="/discover"
          />
        </div>
      </div>
    </div>
  );
}
