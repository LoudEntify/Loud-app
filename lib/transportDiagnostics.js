// lib/transportDiagnostics.js
// ─────────────────────────────────────────────────────────────
// Fix (b3) -- publisher-transport readiness snapshot.
//
// WHY THIS EXISTS: `room.state === ConnectionState.Connected` does not
// mean data publishing works. Confirmed by reading the installed
// livekit-client 2.21.0 source directly:
//
//   * RTCEngine.ensurePublisherConnected() memoizes its connection
//     attempt in `publisherConnectionPromise` and NEVER clears it on
//     rejection (dist/livekit-client.esm.mjs, ensurePublisherConnected).
//     The only reset is inside pcManager.onStateChange, when the
//     publisher transport reports closed/disconnected/failed.
//   * ensureDataTransportConnected() throws
//     UnexpectedConnectionState('PC manager is closed') when
//     `engine.pcManager` is falsy. negotiate() throws NegotiationError
//     with the SAME message from a different site.
//   * cleanupPeerConnections() is the only thing that nulls pcManager.
//
// So a single publishData that lands while pcManager is absent poisons
// EVERY subsequent publishData on that engine for the rest of the
// connection's life -- no pcManager ever existed for that attempt, so
// no onStateChange was ever attached to clear the memo.
//
// Room.connect() awaits waitForPCInitialConnection() BEFORE emitting
// Connected, so on a clean first connect pcManager exists by the time
// room_connected fires. A failure at the first cut therefore means the
// engine was torn down AFTER Connected -- this snapshot is what tells
// us when, and whether it was our own start sequence.
//
// EVERYTHING HERE READS SDK-INTERNAL FIELDS (`room.engine`, `pcManager`,
// `publisherConnectionPromise`). They are not public API and may vanish
// on any SDK bump. That is exactly why this is isolated in its own file,
// every access is optional-chained, and the whole body is wrapped: this
// is diagnostics, and diagnostics must never throw into the show path.
// If a future SDK version removes these, this degrades to
// `{ available: false }` and nothing else changes.
//
// PRD: Director Experience / Live Show | S&I: Observability
// ─────────────────────────────────────────────────────────────

// RTCEngine's PCState enum, mirrored by value so a snapshot is readable
// in the timeline without cross-referencing the SDK. Falls back to the
// raw value if the SDK ever renumbers these.
const PC_STATE_NAMES = ['new', 'connected', 'disconnected', 'reconnecting'];

function pcStateName(value) {
  if (typeof value !== 'number') return value ?? null;
  return PC_STATE_NAMES[value] ?? value;
}

// WebSocket.readyState, named for the same reason.
const WS_STATE_NAMES = ['connecting', 'open', 'closing', 'closed'];

function wsStateName(value) {
  if (typeof value !== 'number') return value ?? null;
  return WS_STATE_NAMES[value] ?? value;
}

/**
 * Point-in-time readiness of the publisher path, safe to call anywhere.
 *
 * The field that matters most is `hasPcManager`: false is the exact
 * precondition for 'PC manager is closed', and `publisherPromiseSet`
 * being true at the same time means the poisoned memo is already in
 * place and every future publishData will replay its rejection.
 *
 * @returns {object} flat primitives only -- goes straight into a
 *   health_events `detail` column, so no nested SDK objects.
 */
export function describeTransport(room) {
  try {
    const engine = room?.engine;
    if (!engine) {
      return { available: false, roomState: room?.state ? String(room.state) : null };
    }
    const pcManager = engine.pcManager;
    const publisher = pcManager?.publisher;
    const subscriber = pcManager?.subscriber;

    return {
      available: true,
      roomState: room?.state ? String(room.state) : null,
      // The poison preconditions, first because they're what this
      // snapshot exists to answer.
      hasPcManager: !!pcManager,
      publisherPromiseSet: !!engine.publisherConnectionPromise,
      // verifyTransport() is the SDK's own composite readiness check
      // (pcManager present + state CONNECTING/CONNECTED + signal ws
      // open). Logged, deliberately NOT used as a gate -- it's
      // @internal, and a gate built on it would silently change meaning
      // on an SDK bump. The pre-flight probe is the real gate.
      verifyTransport: typeof engine.verifyTransport === 'function' ? engine.verifyTransport() : null,
      pcState: pcStateName(engine.pcState),
      pcTransportState: pcManager?.currentState ?? null,
      publisherIce: publisher?.getICEConnectionState?.() ?? null,
      publisherIceConnected: publisher?.isICEConnected ?? null,
      subscriberIce: subscriber?.getICEConnectionState?.() ?? null,
      signalWs: wsStateName(engine.client?.ws?.readyState),
    };
  } catch (err) {
    // An SDK shape change must degrade to a useless snapshot, never an
    // exception on the show's critical path.
    return { available: false, error: String(err?.message || err) };
  }
}
