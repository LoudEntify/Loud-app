'use client';

// GENERIC_REACTIONS: each fires onReact(key) — wire this to a LiveKit data
// message in the real build. Kept dependency-free so it can be dropped in
// before the LiveKit connection exists.
const GENERIC_REACTIONS = [
  { key: 'heart', emoji: '\u2764', className: 'heart' },
  { key: 'fire', emoji: '\uD83D\uDD25', className: 'fire' },
  { key: 'clap', emoji: '\uD83D\uDC4F', className: 'clap' },
  { key: 'laugh', emoji: '\uD83D\uDE02', className: 'laugh' },
  { key: 'plusone', emoji: '+1', className: 'plusone' },
];

const GO_LOUD_THRESHOLD = 50;

// goLoudCount is now the room-wide total, owned by the parent (synced via
// LiveKit data messages in LiveDemo.jsx). This component just displays it
// and reports taps upward — it doesn't keep its own tally, since a shared
// threshold has to reflect everyone in the room, not one client's clicks.
export default function ReactionBar({ onReact, onSuperToggle, goLoudCount = 0, onGoLoud }) {
  return (
    <div className="reaction-bar">
      {GENERIC_REACTIONS.map((r) => (
        <button
          key={r.key}
          className={`reaction-btn ${r.className}`}
          aria-label={r.key}
          onClick={() => onReact && onReact(r.key)}
        >
          {r.emoji}
        </button>
      ))}

      <button className="go-loud-btn" onClick={() => onGoLoud && onGoLoud()}>
        go loud
      </button>
      <span className="go-loud-progress">
        {Math.min(goLoudCount, GO_LOUD_THRESHOLD)}/{GO_LOUD_THRESHOLD}
      </span>

      <button
        className="super-toggle"
        aria-label="toggle super reactions"
        onClick={() => onSuperToggle && onSuperToggle()}
      >
        {'\u2605'}
      </button>
    </div>
  );
}

export { GO_LOUD_THRESHOLD };
