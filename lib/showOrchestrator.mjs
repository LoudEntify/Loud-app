import { assertShowOwner, assertTransition, readinessProblems, safeFailure } from './showOrchestrationCore.mjs';

const START_LEASE_MS = 90_000;

/**
 * Repository: loadShow, ensure, acquireLease, releaseLease, transition,
 * checkpoint and event. Adapters: room, readiness, youtube, output, director,
 * interactions and cameras. All adapter operations must be idempotent.
 */
export function createShowOrchestrator({ repository, room, readiness, youtube, output, director, interactions, cameras, leaseMs = START_LEASE_MS }) {
  async function move(record, to, type, data = {}) {
    assertTransition(record.state, to);
    if (record.state === to) return record;
    const next = await repository.transition(record.show_id, record.version, record.state, to);
    await repository.event(record.show_id, type, record.state, to, data);
    return next;
  }

  async function withLease(showId, artistId, operation, work) {
    const show = assertShowOwner(await repository.loadShow(showId), artistId);
    let record = await repository.ensure(show, artistId);
    const lease = await repository.acquireLease(showId, artistId, operation, leaseMs);
    if (!lease) throw Object.assign(new Error(`Another ${operation} operation is already running`), { code: 'LEASE_BUSY', status: 409, retryable: true });
    record = lease;
    await repository.event(showId, 'LEASE_ACQUIRED', record.state, record.state, { operation });
    try {
      return await work({ show, record });
    } finally {
      await repository.releaseLease(showId, lease.lease_token);
    }
  }

  async function fail(showId, record, error, phase) {
    const failure = safeFailure(error);
    const failed = record.state === 'FAILED' ? record : await move(record, 'FAILED', 'OPERATION_FAILED', { phase, code: failure.code });
    await repository.checkpoint(showId, { last_error_code: failure.code, last_error_message: failure.message, failed_phase: phase, recovery_attempts: (failed.recovery_attempts || 0) + 1 });
    return failure;
  }

  async function start({ showId, artistId, immediate = false, privacy = 'unlisted' }) {
    return withLease(showId, artistId, 'start', async ({ show, record }) => {
      if (record.state === 'LIVE') return { record, idempotent: true };
      if (record.state === 'COMPLETED' || record.state === 'ENDING') throw Object.assign(new Error('A completed or ending show cannot be started'), { status: 409, retryable: false });
      try {
        if (['DRAFT'].includes(record.state)) record = await move(record, 'SCHEDULED', 'SHOW_SCHEDULED');
        if (record.state === 'FAILED') record = await move(record, record.failed_phase === 'ending' ? 'ENDING' : 'PREPARING', 'RECOVERY_STARTED', { operation: 'start' });
        if (record.state === 'SCHEDULED') record = await move(record, 'PREPARING', 'PREPARATION_STARTED');

        if (record.state === 'PREPARING') {
          const mediaReady = await readiness.check({ show });
          const problems = readinessProblems(mediaReady);
          await repository.event(showId, 'MEDIA_READINESS_CHECKED', record.state, record.state, { cameraReady: mediaReady.cameraReady, audioReady: mediaReady.audioReady, problems });
          if (problems.length) throw Object.assign(new Error('Camera and audio must be ready before starting'), { code: problems.join('+'), status: 409, retryable: true });
          await room.ensure({ show });
          await cameras.assignToRoom({ show });
          await director.prepare({ show });
          const broadcast = await youtube.prepare({ showId, artistId, title: show.title, scheduledAt: show.slated_at, immediate, privacy });
          await repository.checkpoint(showId, { readiness: mediaReady, youtube_broadcast_id: broadcast.broadcastId, youtube_stream_id: broadcast.streamId });
          record = await move(record, 'READY', 'SHOW_READY');
        }

        if (record.state === 'READY') record = await move(record, 'STARTING', 'START_REQUESTED');
        if (record.state === 'STARTING') {
          const mediaOutput = await output.start({ show });
          await repository.checkpoint(showId, { output_id: mediaOutput.id, output_started: true });
          await repository.event(showId, 'MEDIA_OUTPUT_STARTED', record.state, record.state, { outputId: mediaOutput.id });
          const ingest = await youtube.waitForIngest({ showId, artistId });
          if (ingest.streamStatus !== 'active') throw Object.assign(new Error('YouTube ingest is not active'), { code: 'YOUTUBE_INGEST_NOT_ACTIVE', retryable: true });
          await repository.event(showId, 'YOUTUBE_INGEST_CONFIRMED', record.state, record.state, { streamStatus: ingest.streamStatus });
          await youtube.transition({ showId, artistId, to: 'live' });
          await director.start({ show });
          await interactions.setStatus({ show, status: 'live' });
          record = await move(record, 'LIVE', 'SHOW_LIVE');
          await repository.markShowStarted(showId);
        }
        return { record, idempotent: false };
      } catch (error) {
        const phase = record.state === 'ENDING' ? 'ending' : record.state.toLowerCase();
        const failure = await fail(showId, record, error, phase);
        error.orchestrationFailure = failure;
        throw error;
      }
    });
  }

  async function stop({ showId, artistId, reason = 'artist' }) {
    return withLease(showId, artistId, 'stop', async ({ show, record }) => {
      if (record.state === 'COMPLETED') return { record, idempotent: true };
      if (!['LIVE', 'STARTING', 'ENDING', 'FAILED'].includes(record.state)) throw Object.assign(new Error('This show is not running'), { status: 409, retryable: false });
      try {
        if (record.state === 'FAILED') record = await move(record, 'ENDING', 'RECOVERY_STARTED', { operation: 'stop' });
        else if (record.state !== 'ENDING') record = await move(record, 'ENDING', 'END_REQUESTED', { reason });
        await interactions.setStatus({ show, status: 'ending' });
        await youtube.transition({ showId, artistId, to: 'complete' });
        await output.stop({ show });
        await director.stop({ show });
        await cameras.release({ show });
        await room.close({ show });
        await interactions.setStatus({ show, status: 'completed' });
        record = await move(record, 'COMPLETED', 'SHOW_COMPLETED', { reason });
        await repository.markShowEnded(showId, reason);
        return { record, idempotent: false };
      } catch (error) {
        const failure = await fail(showId, record, error, 'ending');
        error.orchestrationFailure = failure;
        throw error;
      }
    });
  }

  async function cancel({ showId, artistId, reason = 'artist_cancelled' }) {
    return withLease(showId, artistId, 'cancel', async ({ show, record }) => {
      if (record.state === 'COMPLETED') return { record, idempotent: true };
      if (!['DRAFT', 'SCHEDULED', 'FAILED'].includes(record.state)) throw Object.assign(new Error('A running show must be stopped, not cancelled'), { status: 409 });
      const completed = await move(record, 'COMPLETED', 'SHOW_CANCELLED', { reason });
      await interactions.setStatus({ show, status: 'cancelled' });
      await repository.markShowCancelled(showId, reason);
      return { record: completed, idempotent: false };
    });
  }

  async function reconcile({ showId, artistId }) {
    return withLease(showId, artistId, 'reconcile', async ({ show, record }) => {
      const external = await Promise.allSettled([room.status({ show }), output.status({ show }), youtube.status({ showId, artistId }), director.status({ show })]);
      const snapshot = external.map(result => result.status === 'fulfilled' ? result.value : { error: safeFailure(result.reason).code });
      await repository.event(showId, 'RECONCILIATION_CHECKED', record.state, record.state, { snapshot });
      if (record.state === 'LIVE' && snapshot[1]?.active !== true) {
        const error = Object.assign(new Error('Live media output is no longer active'), { code: 'OUTPUT_NOT_ACTIVE' });
        await fail(showId, record, error, 'live');
        return { action: 'marked_failed', snapshot };
      }
      if (record.state === 'FAILED' && record.failed_phase === 'starting') {
        try {
          record = await move(record, 'STARTING', 'RECOVERY_STARTED', { operation: 'reconcile_start' });
          if (snapshot[1]?.active !== true) {
            const mediaOutput = await output.start({ show });
            await repository.checkpoint(showId, { output_id: mediaOutput.id, output_started: true });
          }
          const ingest = await youtube.waitForIngest({ showId, artistId });
          if (ingest.streamStatus !== 'active') throw Object.assign(new Error('YouTube ingest is not active'), { code: 'YOUTUBE_INGEST_NOT_ACTIVE' });
          await youtube.transition({ showId, artistId, to: 'live' });
          await director.start({ show });
          await interactions.setStatus({ show, status: 'live' });
          record = await move(record, 'LIVE', 'SHOW_RECOVERED');
          await repository.markShowStarted(showId);
          return { action: 'resumed_start', record, snapshot };
        } catch (error) {
          await fail(showId, record, error, 'starting');
          throw error;
        }
      }
      if (record.state === 'ENDING' || (record.state === 'FAILED' && record.failed_phase === 'ending')) {
        try {
          if (record.state === 'FAILED') record = await move(record, 'ENDING', 'RECOVERY_STARTED', { operation: 'reconcile_cleanup' });
          await interactions.setStatus({ show, status: 'ending' });
          await youtube.transition({ showId, artistId, to: 'complete' });
          await output.stop({ show });
          await director.stop({ show });
          await cameras.release({ show });
          await room.close({ show });
          await interactions.setStatus({ show, status: 'completed' });
          record = await move(record, 'COMPLETED', 'SHOW_RECOVERED');
          await repository.markShowEnded(showId, 'recovery');
          return { action: 'completed_cleanup', record, snapshot };
        } catch (error) {
          await fail(showId, record, error, 'ending');
          throw error;
        }
      }
      return { action: 'observed', record, snapshot };
    });
  }

  return { start, stop, cancel, reconcile };
}
