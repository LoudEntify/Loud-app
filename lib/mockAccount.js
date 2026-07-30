'use client';

// Mock stand-in for a real logged-in account/session -- this pilot has no
// auth or persistence backend, so "who am I" (fan vs artist) lives in
// localStorage only. Set once at mock signup (Auth.jsx) or via the
// "Upgrade to artist account" action in Account Settings; read by Sidebar
// to decide where the PROFILE nav item routes. Fan -> artist is the only
// direction -- there's no downgrade path for this pilot.
const STORAGE_KEY = 'loudentify:accountType';
const CHANGE_EVENT = 'loudentify:accountType-change';

export function getAccountType() {
  if (typeof window === 'undefined') return 'fan';
  return localStorage.getItem(STORAGE_KEY) === 'artist' ? 'artist' : 'fan';
}

export function setAccountType(type) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, type);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// Sidebar (rendered as a sibling of whatever page calls setAccountType)
// needs to react without a full reload -- e.g. clicking "Upgrade to
// artist account" in Account Settings should update PROFILE's
// destination immediately. A custom event is the simplest pub/sub that
// works across sibling client components without a context provider.
export function onAccountTypeChange(callback) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
