// Forgot password (lib/passwordReset.js): the rules both the web and the
// native app obey. The screens are checked in tests/e2e/site.e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PASSWORD, validateResetRequest, validateNewPassword, resetErrorMessage, resetRedirectTo, RESET_SENT_MESSAGE } from '../lib/passwordReset.js';

test('validateResetRequest: trims and lower-cases, refuses what is not an address', () => {
  assert.deepEqual(validateResetRequest('  Korey@Example.COM '), { ok: true, email: 'korey@example.com', error: null });
  assert.equal(validateResetRequest('').ok, false);
  assert.equal(validateResetRequest('korey').ok, false);
  assert.equal(validateResetRequest('korey@example').ok, false);
  assert.match(validateResetRequest('').error, /Type the email/);
});

test('the sent message never says whether the account exists', () => {
  assert.match(RESET_SENT_MESSAGE, /If that email has an account/);
  assert.doesNotMatch(RESET_SENT_MESSAGE, /we sent|your account|no account/i);
});

test('validateNewPassword: length, and the second box catches a typo', () => {
  assert.equal(validateNewPassword('x'.repeat(MIN_PASSWORD), 'x'.repeat(MIN_PASSWORD)).ok, true);
  const short = validateNewPassword('short', 'short');
  assert.equal(short.ok, false); assert.match(short.error, /at least 8/);
  const mismatch = validateNewPassword('longenough1', 'longenough2');
  assert.equal(mismatch.ok, false); assert.match(mismatch.error, /do not match/);
  // one box only (the native screen) still checks the length
  assert.equal(validateNewPassword('longenough1').ok, true);
});

test('resetErrorMessage turns provider errors into something a person can act on', () => {
  assert.match(resetErrorMessage({ message: 'Token has expired or is invalid' }), /expired/);
  assert.match(resetErrorMessage({ message: 'New password should be different from the old password' }), /already your password/);
  assert.match(resetErrorMessage({ message: 'For security purposes, too many requests' }), /Wait a minute/);
  assert.equal(resetErrorMessage({ message: 'Something odd happened' }), 'Something odd happened');
  assert.equal(resetErrorMessage(null), null);
});

test('resetRedirectTo points the emailed link back at the reset screen', () => {
  assert.equal(resetRedirectTo('https://loudentify.com'), 'https://loudentify.com/reset-password');
  assert.equal(resetRedirectTo('http://localhost:3000/'), 'http://localhost:3000/reset-password');
  assert.equal(resetRedirectTo(''), undefined);
});
