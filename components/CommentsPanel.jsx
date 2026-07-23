'use client';

import { useRef, useState } from 'react';

// A small, common emoji set for the comment composer -- not the sticker
// set. This is the "regular messaging app" emoji library referenced in
// the spec, kept as a fixed grid rather than relying on any external
// emoji-picker package.
const EMOJI_SET = [
  '\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F525}', '\u{1F44F}', '\u{1F622}',
  '\u{1F62E}', '\u{1F64F}', '\u{1F4AF}', '\u{1F389}', '\u{1F605}', '\u{1F60E}',
  '\u{1F914}', '\u{1F621}', '\u{1F44D}', '\u{1F44E}', '\u{2764}', '\u{1F494}',
  '\u{1F634}', '\u{1F92F}', '\u{1F64C}', '\u{2728}', '\u{1F62D}', '\u{1F973}',
];

// CommentsPanel is shared by both artists and fans. Long-press (hold) a
// comment to reply or quote it. Expands to half the screen while the
// composer is focused, and collapses back to its resting size on a
// swipe-down inside the panel or a tap on the main stage (handled by the
// parent via `onCollapseRequest` / controlled `expanded` prop).
export default function CommentsPanel({ comments, onSend, expanded, onExpand, onCollapse }) {
  const [text, setText] = useState('');
  const [replyTarget, setReplyTarget] = useState(null); // { id, author, text, mode }
  const [actionMenuFor, setActionMenuFor] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const pressTimer = useRef(null);
  const touchStartY = useRef(null);
  const textareaRef = useRef(null);

  function startPress(commentId) {
    pressTimer.current = setTimeout(() => setActionMenuFor(commentId), 450);
  }
  function endPress() {
    clearTimeout(pressTimer.current);
  }

  function pickAction(comment, mode) {
    setReplyTarget({ id: comment.id, author: comment.author, text: comment.text, mode });
    setActionMenuFor(null);
    textareaRef.current?.focus();
  }

  function handleSend() {
    if (!text.trim()) return;
    onSend(text.trim(), replyTarget);
    setText('');
    setReplyTarget(null);
  }

  function onTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchEnd(e) {
    if (touchStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (dy > 40) onCollapse();
    touchStartY.current = null;
  }

  return (
    <div
      className={`comments-panel ${expanded ? 'expanded' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="comments-list">
        {comments.map((c) => (
          <div
            key={c.id}
            className="comment-row"
            onPointerDown={() => startPress(c.id)}
            onPointerUp={endPress}
            onPointerLeave={endPress}
          >
            {c.replyMode === 'reply' && (
              <div className="reply-indicator">
                <span className="reply-arrow">{'\u21B3'}</span> replying to {c.replyAuthor}
              </div>
            )}
            {c.replyMode === 'quote' && (
              <div className="quote-block">&ldquo;{c.quoteText}&rdquo; &mdash; {c.replyAuthor}</div>
            )}
            <div className="comment-body">
              <strong>{c.author}: </strong>{c.text}
            </div>

            {actionMenuFor === c.id && (
              <div className="comment-action-menu">
                <button onClick={() => pickAction(c, 'reply')}>Reply</button>
                <button onClick={() => pickAction(c, 'quote')}>Quote</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {replyTarget && (
        <div className="composing-context">
          {replyTarget.mode === 'reply' ? 'Replying to ' : 'Quoting '}{replyTarget.author}
          <button onClick={() => setReplyTarget(null)}>{'\u00D7'}</button>
        </div>
      )}

      <div className="comment-input-row">
        <button className="emoji-toggle" onClick={() => setShowEmoji((v) => !v)}>{'\u{1F600}'}</button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={onExpand}
          placeholder="Add a comment..."
        />
        <button onClick={handleSend}>Send</button>
      </div>

      {showEmoji && (
        <div className="emoji-grid">
          {EMOJI_SET.map((e) => (
            <button key={e} onClick={() => setText((t) => t + e)}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}
