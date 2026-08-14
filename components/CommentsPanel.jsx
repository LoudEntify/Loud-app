'use client';

import { useRef, useState } from 'react';
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';
import { SmileyIcon as SmileyFallback } from '@phosphor-icons/react';
import PresenceCounter from './PresenceCounter';

// Full emoji library (emoji-picker-react, MIT licensed, actively
// maintained) replaces the earlier hand-picked 24-emoji grid -- this is
// the "full library of emojis / open-source reactions that messaging apps
// use" piece, standing in until custom Loudentify stickers are designed.

export default function CommentsPanel({ comments, onSend, expanded, onExpand, onCollapse }) {
  const [text, setText] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
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

      <div className="comment-input-row" style={{ position: 'relative' }}>
        <button className="emoji-toggle" onClick={() => setShowEmoji((v) => !v)} aria-label="open emoji picker">
          <SmileyFallback size={22} weight="regular" />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={onExpand}
          placeholder="Add a comment..."
        />
        <button onClick={handleSend}>Send</button>

        {showEmoji && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 20 }}>
            <EmojiPicker
              theme={Theme.DARK}
              emojiStyle={EmojiStyle.NATIVE}
              onEmojiClick={(emojiData) => {
                setText((t) => t + emojiData.emoji);
                setShowEmoji(false);
                textareaRef.current?.focus();
              }}
              width={300}
              height={360}
              searchDisabled={false}
            />
          </div>
        )}
      </div>

      {/* Directly below the comment box, inside the same always-mounted
          panel -- inherits its collapse/reveal/position behavior for
          free (MULTI_PERFORMER_SPEC.md follow-up fix): no separate
          state, no separate positioning logic. */}
      <PresenceCounter />
    </div>
  );
}
