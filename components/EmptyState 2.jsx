'use client';

const INK = '#011627';
const TEAL = '#2ec4b6';

// Honest empty state. Used wherever mock data used to sit.
//
// The rule this encodes: an empty surface should say what WILL be here
// and how to make it happen, never invent something to fill the space.
// Fake activity in a product like this is worse than a blank panel --
// an artist who sees invented supporters or invented earnings stops
// trusting the numbers that are real.
export default function EmptyState({ title, body, action, onAction, actionHref, compact = false }) {
  const Wrapper = actionHref ? 'a' : 'button';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 6,
        padding: compact ? '22px 18px' : '40px 24px',
        border: '1px dashed rgba(1,22,39,0.15)',
        clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
      }}
    >
      <div style={{ fontSize: compact ? 13 : 14, fontWeight: 700, color: INK }}>{title}</div>
      {body && (
        <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.5)', lineHeight: 1.5, maxWidth: 380 }}>{body}</div>
      )}
      {action && (
        <Wrapper
          href={actionHref || undefined}
          onClick={onAction}
          style={{
            marginTop: 8,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: TEAL,
            background: 'transparent',
            border: `1px solid ${TEAL}`,
            borderRadius: 999,
            padding: '8px 14px',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          {action}
        </Wrapper>
      )}
    </div>
  );
}
