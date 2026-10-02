// Phase 5 website: the pure pieces (contact validation, help search, the
// schedule's day buckets, show-state labels). Browser behaviour is in
// tests/e2e/site.e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContact, TOPICS } from '../lib/site/contact.js';
import { searchArticles, ARTICLES, MOST_ASKED } from '../lib/site/help.js';

test('contact: a good message passes, trimmed and lower-cased email', () => {
  const v = validateContact({ topic: 'press', name: '  Ama  ', email: 'AMA@Example.com ', message: 'Hello there' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.values, { topic: 'press', name: 'Ama', email: 'ama@example.com', message: 'Hello there' });
});

test('contact: every field is checked and named', () => {
  const v = validateContact({ topic: 'nope', name: '', email: 'not-an-email', message: '' });
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.errors).sort(), ['email', 'message', 'name', 'topic']);
});

test('contact: the honeypot marks spam without saying so to the sender', () => {
  const v = validateContact({ topic: 'general', name: 'Bot', email: 'b@b.co', message: 'buy', website: 'http://spam' });
  assert.equal(v.ok, false); assert.equal(v.errors.website, 'spam');
});

test('contact: message length is capped at 4000', () => {
  const v = validateContact({ topic: 'general', name: 'A', email: 'a@b.co', message: 'x'.repeat(4001) });
  assert.equal(v.errors.message, 'Keep it under 4000 characters');
  assert.ok(TOPICS.includes('report'));
});

test('help: search matches title and body, empty for no match and blank', () => {
  assert.ok(searchArticles('mic').some((a) => a.slug === 'mic-stopped'));
  assert.ok(searchArticles('72.5').some((a) => a.slug === 'cash-out'));
  assert.deepEqual(searchArticles('zzzz-nothing'), []);
  assert.deepEqual(searchArticles('   '), []);
});

test('help: the most-asked list only names real articles and slugs are unique', () => {
  const slugs = ARTICLES.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of MOST_ASKED) assert.ok(slugs.includes(s), s);
});
