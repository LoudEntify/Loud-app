import 'server-only';
import { randomUUID } from 'node:crypto';

export function createShowOrchestrationRepository(admin, actorId, workerId = `web:${process.pid}`) {
  async function one(query, message) {
    const { data, error } = await query.maybeSingle();
    if (error || !data) throw new Error(message);
    return data;
  }
  return {
    async loadShow(showId) {
      const { data, error } = await admin.from('shows').select('id,artist_id,title,room_name,slated_at,performance_mode,state,actual_started_at,actual_ended_at').eq('id', showId).maybeSingle();
      if (error) throw new Error('Could not load show');
      return data;
    },
    async ensure(show, artistId) {
      const { error } = await admin.from('show_orchestrations').upsert({ show_id: show.id, artist_id: artistId, state: show.state === 'ended' ? 'COMPLETED' : 'SCHEDULED' }, { onConflict: 'show_id', ignoreDuplicates: true });
      if (error) throw new Error('Could not initialize show orchestration');
      return one(admin.from('show_orchestrations').select('*').eq('show_id', show.id).eq('artist_id', artistId), 'Could not load show orchestration');
    },
    async acquireLease(showId, artistId, operation, leaseMs) {
      const token = randomUUID();
      const { data, error } = await admin.rpc('acquire_show_orchestration_lease', {
        p_show_id: showId, p_artist_id: artistId, p_operation: operation,
        p_lease_token: token, p_lease_owner: workerId, p_lease_seconds: Math.ceil(leaseMs / 1000),
      });
      if (error) throw new Error('Could not acquire show orchestration lease');
      return data?.[0] || null;
    },
    async releaseLease(showId, leaseToken) {
      if (!leaseToken) return;
      await admin.from('show_orchestrations').update({ lease_token: null, lease_owner: null, lease_expires_at: null, desired_operation: null, updated_at: new Date().toISOString() }).eq('show_id', showId).eq('lease_token', leaseToken);
    },
    async transition(showId, version, from, to) {
      return one(admin.from('show_orchestrations').update({ state: to, version: version + 1, updated_at: new Date().toISOString() }).eq('show_id', showId).eq('state', from).eq('version', version).select('*'), 'Show orchestration changed concurrently');
    },
    async checkpoint(showId, patch) {
      const columns = {};
      const checkpoint = {};
      for (const [key, value] of Object.entries(patch)) {
        if (['recovery_attempts', 'failed_phase', 'last_error_code', 'last_error_message'].includes(key)) columns[key] = value;
        else checkpoint[key] = value;
      }
      const current = await one(admin.from('show_orchestrations').select('checkpoints').eq('show_id', showId), 'Could not load orchestration checkpoints');
      await one(admin.from('show_orchestrations').update({ ...columns, checkpoints: { ...(current.checkpoints || {}), ...checkpoint }, updated_at: new Date().toISOString() }).eq('show_id', showId).select('*'), 'Could not save orchestration checkpoint');
    },
    async event(showId, eventType, fromState, toState, data = {}) {
      const { error } = await admin.from('show_orchestration_events').insert({ show_id: showId, event_type: eventType, from_state: fromState, to_state: toState, actor_id: actorId, data });
      if (error) throw new Error('Could not append show orchestration event');
    },
    async markShowStarted(showId) {
      await admin.from('shows').update({ state: 'soundcheck', actual_started_at: new Date().toISOString() }).eq('id', showId).eq('artist_id', actorId).is('actual_started_at', null);
    },
    async markShowEnded(showId, reason) {
      await admin.from('shows').update({ state: 'ended', actual_ended_at: new Date().toISOString(), ended_by: reason === 'artist' ? 'artist' : 'webhook' }).eq('id', showId).eq('artist_id', actorId);
    },
    async markShowCancelled(showId, reason) {
      await admin.from('shows').update({ state: 'ended', cancelled_at: new Date().toISOString(), cancelled_reason: reason, actual_ended_at: new Date().toISOString(), ended_by: 'artist' }).eq('id', showId).eq('artist_id', actorId);
    },
  };
}
