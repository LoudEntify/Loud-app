// lib/pipeline/livekitEgress.js — the real compositor, as the lifecycle
// uses it: mix the room's cameras into one portrait picture and push it
// to YouTube's ingest.
//
// WHY THIS EXISTS. Until now `goLive` always drove FakeEgress, which
// writes the director's decisions to NDJSON and counts frames it never
// sends. Everything around it was real — the phones published into a
// LiveKit room, a YouTube broadcast was created, bound to a stream and
// transitioned to live — so a viewer got a player, a LIVE badge and a
// show that never carried a single frame. `app/api/egress/start`
// already did a room composite, but to an MP4 in S3 with no RTMP
// output, and nothing in the running app called it. The missing step
// was never a setting; it was this file.
//
// WHAT IT DOES. LiveKit's Egress service runs a headless browser
// against our own template page (components/EgressPage.jsx), which
// renders the same directed view a viewer sees, and encodes that to
// 1080x1920. The outputs are one RTMP url per YouTube target, plus an
// MP4 to S3 when the storage variables are configured — a show that
// cannot be archived must still go out, so the file is optional and the
// stream is not.
//
// WHAT IT IS NOT. It does not push frames: `pushFrame` is a no-op
// because the real compositor pulls from the room on its own clock.
// The console's tick still drives the director's decisions, which reach
// the template through the show row, not through this object.
import { EgressClient } from 'livekit-server-sdk';
import { StreamOutput, StreamProtocol, EncodedFileOutput, EncodedFileType, EncodingOptions, S3Upload, EgressStatus } from '@livekit/protocol';

const OUTPUT = { width: 1080, height: 1920 };

export function toHttpUrl(wsUrl) {
  return String(wsUrl || '').replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/**
 * One RTMP url per target, with the key appended.
 *
 * YouTube hands back an ingest url and a key separately and expects
 * them joined with a slash; a double slash is rejected with an error
 * that reads like a bad key, which is an afternoon lost. Targets with
 * no key are dropped rather than sent as a half url — a broadcast whose
 * key never arrived is a broadcast that would fail anyway, and the
 * lifecycle already records it as not delivering.
 *
 * The url carries a stream key, so it is a secret: it is never logged,
 * never returned, and never written to a file.
 */
export function rtmpUrls(targets = []) {
  return targets
    .filter((t) => t && t.ingestUrl && t.streamKey)
    .map((t) => `${String(t.ingestUrl).replace(/\/+$/, '')}/${t.streamKey}`);
}

/** The S3 file output, or null when the storage variables are not set. */
export function fileOutputFor(room, env = process.env) {
  const { LIVEKIT_S3_ACCESS_KEY: accessKey, LIVEKIT_S3_SECRET: secret, LIVEKIT_S3_ENDPOINT: endpoint, LIVEKIT_S3_REGION: region, LIVEKIT_S3_BUCKET: bucket } = env;
  if (!accessKey || !secret || !endpoint || !region || !bucket) return null;
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${room}-${Date.now()}.mp4`,
    output: { case: 's3', value: new S3Upload({ accessKey, secret, region, endpoint: String(endpoint).replace(/\/+$/, ''), bucket, forcePathStyle: true }) },
  });
}

export class LiveKitEgress {
  /**
   * @param clientFactory  injected in tests; in production it builds a
   *   real EgressClient. Separating it is what makes this file testable
   *   without a LiveKit account, which is the whole reason the previous
   *   attempt stayed a stub.
   */
  constructor({ env = process.env, clientFactory = null } = {}) {
    this.env = env;
    this.configured = Boolean(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL && env.EGRESS_TEMPLATE_BASE_URL);
    this.clientFactory = clientFactory || (() => new EgressClient(toHttpUrl(env.LIVEKIT_URL), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET));
    this.state = 'idle';
    this.egressId = null;
    this.room = null;
    this.targetCount = 0;
    this.lastError = null;
  }

  client() {
    if (!this._client) this._client = this.clientFactory();
    return this._client;
  }

  /**
   * @param room            the LiveKit room the cameras are publishing into
   * @param performanceMode 'solo' | 'versus' — picks the template layout
   * @param targets         [{ broadcastId, ingestUrl, streamKey }]
   */
  async start({ room, performanceMode = 'solo', targets = [] } = {}) {
    if (!this.configured) {
      throw new Error('The real compositor is not configured on this server (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, EGRESS_TEMPLATE_BASE_URL). See docs/NEEDS_KOREY.md.');
    }
    if (!room) throw new Error('The compositor needs the show\'s room.');
    const urls = rtmpUrls(targets);
    if (!urls.length) {
      // Deliberately not an error. The lifecycle starts a show whether
      // or not YouTube is ready, and a composite with no outputs is a
      // billed browser rendering to nowhere.
      this.state = 'idle';
      this.lastError = 'no_targets';
      return { ok: false, reason: 'no_targets', recordingPath: null };
    }
    const base = String(this.env.EGRESS_TEMPLATE_BASE_URL).replace(/\/+$/, '');
    const client = this.client();

    // One composite per room. A versus show has two performer devices
    // and either may arrive first; a retry after a slow response is the
    // same situation. Stacking a second composite doubles the bill and
    // sends two pictures to one key.
    const active = await client.listEgress({ roomName: room, active: true });
    if (active.length) {
      this.state = 'running'; this.egressId = active[0].egressId; this.room = room; this.targetCount = urls.length;
      return { ok: true, alreadyActive: true, egressId: this.egressId, recordingPath: null };
    }

    const outputs = { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls }) };
    const file = fileOutputFor(room, this.env);
    if (file) outputs.file = file;

    const info = await client.startRoomCompositeEgress(room, outputs, {
      layout: performanceMode === 'versus' ? 'versus' : 'solo',
      customBaseUrl: `${base}/egress`,
      encodingOptions: new EncodingOptions(OUTPUT),
    });
    this.state = 'running'; this.egressId = info.egressId; this.room = room; this.targetCount = urls.length;
    return { ok: true, egressId: info.egressId, recordingPath: file ? 's3' : null, targets: urls.length };
  }

  /** The real compositor pulls from the room; there is nothing to push. */
  pushFrame() { return { framesOut: 0 }; }

  /**
   * Add or replace a YouTube target without restarting the composite.
   *
   * deliveryTick creates a new broadcast when one is abandoned, and a
   * restart here would blank the picture for everyone watching the
   * broadcast that is still fine.
   */
  async retarget(_broadcastId, { ingestUrl, streamKey } = {}) {
    if (!this.egressId) throw new Error('The compositor is not running.');
    const url = rtmpUrls([{ ingestUrl, streamKey }])[0];
    if (!url) throw new Error('A compositor target needs a stream key.');
    await this.client().updateStream(this.egressId, [url], []);
    this.targetCount += 1;
    return { ok: true };
  }

  health() {
    return { state: this.configured ? this.state : 'unconfigured', delivering: {}, framesOut: 0, egressId: this.egressId };
  }

  /**
   * Live health, for the console's tick. Separate from health() because
   * it costs a network call, and health() is called on a timer.
   */
  async liveHealth() {
    if (!this.egressId) return { state: this.state, delivering: {} };
    const [info] = await this.client().listEgress({ egressId: this.egressId });
    const status = info ? (EgressStatus[info.status] ?? info.status) : null;
    return { state: status === 'EGRESS_ACTIVE' ? 'running' : String(status || 'unknown'), error: info?.error || null, delivering: {} };
  }

  async stop() {
    if (!this.egressId) { this.state = 'stopped'; return { recording: null, training: null, framesOut: 0 }; }
    try { await this.client().stopEgress(this.egressId); } catch (e) { this.lastError = String(e?.message || e).slice(0, 200); }
    this.state = 'stopped';
    const id = this.egressId; this.egressId = null;
    // The file lands in S3 asynchronously and is reconciled by
    // app/api/egress/webhook → app/api/recordings/sync, so there is no
    // path to hand back here.
    return { recording: null, training: null, framesOut: 0, egressId: id };
  }
}
