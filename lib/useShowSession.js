'use client';

// lib/useShowSession.js
// ─────────────────────────────────────────────────────────────
// TASK 1, the React side — subscribe to the server row and treat it as
// source of truth.
//
// PRD: Director Experience / Live Show    S&I: Database, Real-time media
//
// ── THE CONTRACT ──────────────────────────────────────────────
// `state` is a CACHE of the row, never the master copy. Every write goes
// through `patch()`, which writes to Postgres; the Realtime subscription
// echoes it back and that echo is what updates `state`.
//
// The one deliberate exception is the optimistic apply inside patch():
// waiting for a round trip before showing the artist their own click
// would make the UI feel broken. The echo overwrites it moments later,
// so the server still wins any disagreement — the optimism is about
// latency, not authority.
//
// ── DEGRADES BEFORE THE MIGRATION IS RUN ──────────────────────
// `missing` is true when the table does not exist. Callers keep working
// exactly as they did before — in-memory only — rather than breaking.
// The branch has to be usable before the SQL is run, not after.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSessionState,
  patchSessionState,
  subscribeSessionState,
  emptyState,
} from './showSessionState';

export function useShowSession(showId, artistId) {
  const [state, setState] = useState(() => emptyState(showId, artistId));
  const [ready, setReady] = useState(false);
  // Guards the echo: a Realtime payload that arrives while a local write
  // is still in flight must not resurrect the value we just replaced.
  const inFlightRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    if (!showId || !artistId) {
      setState(emptyState(showId, artistId));
      setReady(true);
      return undefined;
    }

    (async () => {
      const row = await loadSessionState(showId, artistId);
      if (cancelled) return;
      setState(row);
      setReady(true);
    })();

    const unsubscribe = subscribeSessionState(showId, artistId, (row) => {
      if (cancelled) return;
      if (inFlightRef.current > 0) return; // our own write is still settling
      setState((prev) => ({ ...prev, ...row }));
    });

    return () => { cancelled = true; unsubscribe(); };
  }, [showId, artistId]);

  const patch = useCallback(async (changes) => {
    setState((prev) => ({ ...prev, ...changes })); // optimistic
    inFlightRef.current += 1;
    try {
      return await patchSessionState(showId, artistId, changes);
    } finally {
      inFlightRef.current -= 1;
    }
  }, [showId, artistId]);

  return { state, ready, patch, missing: !!state._missing };
}
