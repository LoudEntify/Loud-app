// POST /api/spike/upload-url — SPIKE ONLY (spike/native-device-zoom). Hands
// the signed-in artist a short-lived signed URL to upload one compressed
// director-data batch into the private `director-spike` staging bucket,
// under their own folder. Same pattern as app/api/broll/upload-url. The
// bucket is created in the Supabase dashboard (docs/NEEDS_KOREY.md); if it
// is missing this says so plainly.
//
// Preview and local only (dev harness gate). Delete when the spike ends.
//
// AUTH MODEL: verifyArtistAuth — own folder only; the path is built here,
// never taken from the client.
// PRD row 165. S&I: Background jobs, Database.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { devHarnessAllowed } from '../../../../lib/paymentProvider';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

export const BUCKET = 'director-spike';
const NAME = /^[a-z0-9][a-z0-9._-]{0,120}\.(ndjson\.gz|json)$/i;
const DEVICE = /^[a-z0-9-]{4,64}$/i;

export async function POST(request) {
  const cid = correlationFrom(request);
  if (!devHarnessAllowed()) return withCorrelation(NextResponse.json({ error: 'Spike uploads are only available where the dev harness is allowed.' }, { status: 403 }), cid);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  let body = {}; try { body = await request.json(); } catch { body = {}; }
  const name = String(body.name || ''); const deviceId = String(body.deviceId || '');
  if (!NAME.test(name) || !DEVICE.test(deviceId)) return withCorrelation(NextResponse.json({ error: 'name must be *.ndjson.gz or *.json and deviceId a short id.' }, { status: 400 }), cid);
  const day = new Date().toISOString().slice(0, 10);
  const path = `${auth.user.id}/${day}/${deviceId}/${name}`;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    const missing = /not found|does not exist/i.test(error.message || '');
    return withCorrelation(NextResponse.json({ error: missing ? `The ${BUCKET} bucket does not exist on this project yet (docs/NEEDS_KOREY.md).` : 'Could not create an upload URL.' }, { status: missing ? 503 : 500 }), cid);
  }
  return withCorrelation(NextResponse.json({ bucket: BUCKET, path, signedUrl: data.signedUrl, token: data.token }), cid);
}
