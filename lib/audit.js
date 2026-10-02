// lib/audit.js
// ─────────────────────────────────────────────────────────────
// The application's one way to write the audit log.
//
// Calls public.record_audit_event() (migration 20261002000100) through the
// service-role client. The audit schema itself is never exposed to the
// Data API. "Anything touching money, identity or someone else's data
// leaves an audit trace. If it cannot be audited it does not ship."
//
// A failed audit write is NOT swallowed silently: it returns the error so
// the caller can decide (money paths fail closed; a view change logs and
// carries on — the show must never stop). It is also logged as an error
// line, which is the "audit log write failure" alert ARCHITECTURE.md names.
// ─────────────────────────────────────────────────────────────
import 'server-only';
import { logEvent } from './correlation.js';

export async function recordAuditEvent(admin, {
  actorType, action, subjectType, subjectId = null, actorId = null, correlationId = null, before = null, after = null, metadata = {},
}) {
  const { data, error } = await admin.rpc('record_audit_event', {
    p_actor_type: actorType,
    p_action: action,
    p_subject_type: subjectType,
    p_subject_id: subjectId == null ? null : String(subjectId),
    p_actor_id: actorId,
    p_correlation_id: correlationId,
    p_before: before,
    p_after: after,
    p_metadata: metadata || {},
  });
  if (error) {
    logEvent('error', 'audit.write_failed', { action, subjectType, correlationId, code: error.code, message: error.message });
    return { id: null, error };
  }
  return { id: data, error: null };
}
