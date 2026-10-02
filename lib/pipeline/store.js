// lib/pipeline/store.js — the real store for lib/pipeline/lifecycle.js and
// the per-process egress registry. Server-only.
import 'server-only';
import { recordAuditEvent } from '../audit.js';
import { apiForArtist } from '../youtube/connections.js';
import { encryptForTenant, decryptForTenant } from '../youtube/crypto.js';
import { createEgress } from './egress.js';

const egresses = new Map(); // showId -> egress (one process; the fake persists its files, so a restart loses only the in-memory handle)

export function egressFor(showId) {
  if (!egresses.has(showId)) egresses.set(showId, createEgress());
  return egresses.get(showId);
}
export function forgetEgress(showId) { egresses.delete(showId); }

export function supabaseLifecycleStore(admin) {
  return {
    now: () => Date.now(),
    async loadShow(id) { const { data } = await admin.from('shows').select('*').eq('id', id).maybeSingle(); return data || null; },
    async updateShow(id, patch) { await admin.from('shows').update(patch).eq('id', id); },
    async listBroadcasts(showId) { const { data } = await admin.from('broadcasts').select('*').eq('show_id', showId).order('created_at'); return data || []; },
    async insertBroadcast(row) { const { data, error } = await admin.from('broadcasts').insert(row).select('*').single(); if (error) throw error; return data; },
    async updateBroadcast(id, patch) { await admin.from('broadcasts').update(patch).eq('id', id); },
    apiFor: (userId) => apiForArtist(admin, userId),
    // The key is encrypted per artist before it reaches the identity store;
    // the artist who owns the broadcast's channel is the tenant.
    async storeStreamKey(broadcastId, key, ingestUrl) {
      const { data: b } = await admin.from('broadcasts').select('channel_user_id').eq('id', broadcastId).single();
      await admin.rpc('stream_key_store', { p_broadcast_id: broadcastId, p_key_enc: encryptForTenant(b.channel_user_id, key), p_ingest_url: ingestUrl });
    },
    async readStreamKey(broadcastId) {
      const { data } = await admin.rpc('stream_key_read', { p_broadcast_id: broadcastId });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      const { data: b } = await admin.from('broadcasts').select('channel_user_id').eq('id', broadcastId).single();
      return { key_enc: decryptForTenant(b.channel_user_id, row.key_enc), ingest_url: row.ingest_url };
    },
    async rotateStreamKey(broadcastId) { const { data } = await admin.rpc('stream_key_rotate', { p_broadcast_id: broadcastId }); return Number(data || 0); },
    audit: (e) => recordAuditEvent(admin, e),
  };
}
