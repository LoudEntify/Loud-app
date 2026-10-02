// lib/site/contact.js — validation for the website contact form, shared
// by the route and its tests. No I/O.
export const TOPICS = ['general', 'artist_support', 'payments', 'press', 'report'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateContact(body) {
  const topic = TOPICS.includes(body?.topic) ? body.topic : null;
  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const message = String(body?.message || '').trim();
  const errors = {};
  if (!topic) errors.topic = 'Pick what this is about';
  if (!name || name.length > 120) errors.name = 'Tell us your name';
  if (!EMAIL.test(email) || email.length > 254) errors.email = 'That email does not look right';
  if (!message) errors.message = 'Write us a message';
  if (message.length > 4000) errors.message = 'Keep it under 4000 characters';
  if (body?.website) errors.website = 'spam'; // honeypot field; real people never fill it
  return { ok: Object.keys(errors).length === 0, errors, values: { topic, name, email, message } };
}

