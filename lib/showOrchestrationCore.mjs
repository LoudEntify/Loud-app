export const SHOW_ORCHESTRATION_STATES = Object.freeze([
  'DRAFT', 'SCHEDULED', 'PREPARING', 'READY', 'STARTING', 'LIVE', 'ENDING', 'COMPLETED', 'FAILED',
]);

const LEGAL = Object.freeze({
  DRAFT: ['SCHEDULED', 'COMPLETED'],
  SCHEDULED: ['PREPARING', 'COMPLETED'],
  PREPARING: ['READY', 'FAILED'],
  READY: ['STARTING', 'FAILED'],
  STARTING: ['LIVE', 'ENDING', 'FAILED'],
  LIVE: ['ENDING', 'FAILED'],
  ENDING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['PREPARING', 'STARTING', 'ENDING', 'COMPLETED'],
});

export function canTransition(from, to) {
  return from === to || Boolean(LEGAL[from]?.includes(to));
}

export function assertTransition(from, to) {
  if (!SHOW_ORCHESTRATION_STATES.includes(from) || !SHOW_ORCHESTRATION_STATES.includes(to) || !canTransition(from, to)) {
    const error = new Error(`Illegal show orchestration transition: ${from} -> ${to}`);
    error.code = 'ILLEGAL_TRANSITION';
    error.status = 409;
    throw error;
  }
}

export function assertShowOwner(show, artistId) {
  if (!show) throw Object.assign(new Error('Show not found'), { status: 404 });
  if (!show.artist_id || show.artist_id !== artistId) throw Object.assign(new Error('This show does not belong to this artist'), { status: 403 });
  return show;
}

export function readinessProblems(readiness = {}) {
  const problems = [];
  if (!readiness.cameraReady) problems.push('CAMERA_NOT_READY');
  if (!readiness.audioReady) problems.push('AUDIO_NOT_READY');
  return problems;
}

export function safeFailure(error) {
  return {
    code: String(error?.code || error?.broadcastFailure?.code || 'ORCHESTRATION_FAILED').slice(0, 80),
    message: String(error?.safeMessage || error?.message || 'Show orchestration failed').slice(0, 500),
    retryable: error?.retryable !== false,
  };
}
