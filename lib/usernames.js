export function normaliseUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export function validateUsername(raw) {
  const handle = normaliseUsername(raw);
  if (!handle) return 'Pick a username.';
  if (!USERNAME_PATTERN.test(handle)) return '3-20 characters, lowercase letters, numbers and underscores only.';
  return null;
}
