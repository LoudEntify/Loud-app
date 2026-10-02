'use client';
// lib/viewerApi.js — fetch helpers for the viewer routes. Every call
// carries a correlation id and, when signed in, the session token.
import { apiHeaders } from './telemetry';

export async function api(path, { method = 'GET', body, accessToken, correlationId } = {}) {
  const headers = apiHeaders(accessToken ? { authorization: `Bearer ${accessToken}` } : {}, correlationId);
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data, correlationId: res.headers.get('x-correlation-id') };
}

export function newIdempotencyKey() {
  try { return crypto.randomUUID(); } catch { return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}
