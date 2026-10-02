// native/src/api.js — the native app is a client of the same API as the web
// app (docs/BUILD_PLAN.md Phase 4: "a new client, not a new backend").
import { API_BASE } from './config';

function mintId() { return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`; }

export async function api(path, { method = 'GET', body, accessToken } = {}) {
  const headers = { 'content-type': 'application/json', 'x-correlation-id': mintId() };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}
