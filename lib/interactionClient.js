'use client';

const PREFIX = 'loudentify.interaction.';

export async function interactionToken(showId, accessToken = null) {
  if (!showId) return null;
  try {
    const cached = sessionStorage.getItem(`${PREFIX}${showId}`);
    if (cached) return cached;
  } catch { /* storage unavailable; mint for this request */ }
  const response = await fetch('/api/interactions/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ showId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) return null;
  try { sessionStorage.setItem(`${PREFIX}${showId}`, data.token); } catch { /* reconnect gets a new session */ }
  return data.token;
}
