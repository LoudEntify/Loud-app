'use client';
// design/WebContact: topic chips, name, email, message. States: idle,
// sending, sent, error (with the correlation id to quote back to us).
import { useState } from 'react';
import { api } from '../../lib/viewerApi';

const TOPICS = [['general', 'General'], ['artist_support', 'Artist support'], ['payments', 'Payments'], ['press', 'Press'], ['report', 'Report a problem']];

export default function ContactForm({ initialTopic = 'general' }) {
  const [topic, setTopic] = useState(TOPICS.some(([k]) => k === initialTopic) ? initialTopic : 'general');
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '' });
  const [state, setState] = useState({ kind: 'idle' });
  async function submit(e) {
    e.preventDefault();
    setState({ kind: 'sending' });
    const r = await api('/api/site/contact', { method: 'POST', body: { topic, ...form } }).catch(() => ({ ok: false, data: null }));
    if (r.ok) setState({ kind: 'sent', cid: r.data?.correlationId });
    else setState({ kind: 'error', message: r.data?.error || 'We could not send that.', errors: r.data?.errors || {}, cid: r.correlationId });
  }
  if (state.kind === 'sent') return <div className="w-card" role="status" data-testid="contact-sent"><h2 className="w-h3" style={{ fontSize: 24 }}>Thanks, we have it.</h2><p>We usually reply within two working days. If you need to chase, quote <code>{state.cid}</code>.</p></div>;
  const err = state.kind === 'error' ? state.errors : {};
  return (
    <form className="w-card" onSubmit={submit} data-testid="contact-form" style={{ gap: 18 }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <legend style={{ fontWeight: 700, fontSize: 16, padding: 0, marginBottom: 6 }}>What is this about?</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{TOPICS.map(([k, l]) => <button type="button" key={k} className="w-chip" aria-pressed={topic === k} onClick={() => setTopic(k)}>{l}</button>)}</div>
      </fieldset>
      <div className="w-grid w-grid-2" style={{ gap: 14 }}>
        <label className="w-field">Your name<input className="w-input" name="name" placeholder="First and last" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required aria-invalid={Boolean(err.name)} />{err.name && <span className="w-note" style={{ color: 'var(--red)' }}>{err.name}</span>}</label>
        <label className="w-field">Email<input className="w-input" type="email" name="email" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-invalid={Boolean(err.email)} />{err.email && <span className="w-note" style={{ color: 'var(--red)' }}>{err.email}</span>}</label>
      </div>
      <label className="w-field">Message<textarea className="w-input" name="message" rows={6} placeholder="Tell us what is going on" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required aria-invalid={Boolean(err.message)} />{err.message && <span className="w-note" style={{ color: 'var(--red)' }}>{err.message}</span>}</label>
      <label style={{ position: 'absolute', left: -9999 }} aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="w-pill w-pill-lg w-pill-teal" disabled={state.kind === 'sending'}>{state.kind === 'sending' ? 'Sending…' : 'Send message'}</button>
        <span className="w-note">We usually reply within two working days.</span>
      </div>
      {state.kind === 'error' && <div className="w-error" role="alert" data-testid="contact-error"><strong>{state.message}</strong>{state.cid && <span className="w-note">Reference {state.cid}</span>}</div>}
    </form>
  );
}
