import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSignup, parseDateOfBirth, ageOn, validateUsername } from '../lib/signupRules.js';

const today = '2026-10-02';
const base = { role: 'viewer', firstName: 'Ama', lastName: 'K', username: '@ama_k', email: 'ama@example.com', password: 'longenough1', dateOfBirth: '02 / 10 / 2008', country: 'gb', city: 'London', acceptTerms: true };

test('18 on the day is allowed; 18 tomorrow is refused and the date is not returned', () => {
  const ok = validateSignup(base, { today });
  assert.equal(ok.ok, true); assert.equal(ok.values.dateOfBirth, '2008-10-02'); assert.equal(ok.values.username, 'ama_k'); assert.equal(ok.values.country, 'GB');
  const young = validateSignup({ ...base, dateOfBirth: '03/10/2008' }, { today });
  assert.equal(young.ok, false); assert.equal(young.underage, true); assert.equal(young.values, null);
  assert.equal(JSON.stringify(young).includes('2008-10-03'), false, 'an under-18 date never leaves validation');
});

test('dates: leap day, impossible day, future, ISO form, two-digit year', () => {
  assert.equal(parseDateOfBirth('29/02/2000'), '2000-02-29');
  assert.equal(parseDateOfBirth('29/02/2001'), null);
  assert.equal(parseDateOfBirth('2000-02-29'), '2000-02-29');
  assert.equal(parseDateOfBirth('1/1/99'), null);
  assert.equal(ageOn('2000-02-29', '2026-02-28'), 25);
  assert.equal(ageOn('2000-02-29', '2026-03-01'), 26);
  const future = validateSignup({ ...base, dateOfBirth: '01/01/2030' }, { today });
  assert.equal(future.ok, false); assert.ok(future.errors.dateOfBirth);
});

test('required fields and terms', () => {
  assert.ok(validateUsername('ab')); assert.equal(validateUsername('good_name9'), null);
  const r = validateSignup({ ...base, acceptTerms: false, email: 'nope', password: 'short', country: 'United Kingdom' }, { today });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['acceptTerms', 'country', 'email', 'password']);
  const artist = validateSignup({ ...base, role: 'artist', stageName: 'AMA', trainingDataOptOut: true }, { today });
  assert.equal(artist.values.displayName, 'AMA'); assert.equal(artist.values.trainingDataOptOut, true);
  assert.equal(validateSignup(base, { today }).values.trainingDataOptOut, null, 'viewers never carry the training-data choice');
});
