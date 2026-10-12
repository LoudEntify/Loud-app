import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { devHarnessAllowed } from '../../../../lib/paymentProvider';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

// SPIKE-ONLY. Signed upload URL for one batch of director data
// (docs/DIRECTOR_DATA_SPEC.md, streams B2 B4 B5 B12) from the phone into
// the PRIVATE staging bucket `director-spike`.
//
// Same shape as app/api/broll/upload-url/route.js and for the same
// reason: the bytes go straight from the phone to storage, this route
// never sees them. The object path is SERVER-CHOSEN under the caller's
// own user id; the client proposes only the batch file name and its
// device id, both validated against strict patterns.
//
// AUTH MODEL: artist session plus the dev-harness gate; never on
// production. The bucket must exist and be private — created by hand in
// the Supabase dashboard (docs/NEEDS_KOREY.md), because an SQL insert
// into storage.buckets has failed silently on this project before.
//
// DELETE THIS ROUTE WHEN THE SPIKE ENDS, or promote it to a real ingest
// route with the storage rules in the spec.
export const BUCKET = 'director-spike';
const SIGNED_UPLOAD_TTL_SECONDS = 60 * 10;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,120}\.(ndjson\.gz|json)$/;
const DEVICE_RE = /^[a-z0-9][a-z0-9-]{3,63}$/;

export async function POST(request) {
  const cid = correlationFrom(request);
  if (!devHarnessAllowed()) {
    return withCorrelation(
      NextResponse.json({ error: 'The spike upload route is only available where the dev harness is allowed.' }, { status: 403 }),
      cid
    );
  }
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '');
  const deviceId = String(body.deviceId || '');
  if (!NAME_RE.test(name)) return withCorrelation(NextResponse.json({ error: 'name must be <slug>.ndjson.gz or <slug>.json' }, { status: 400 }), cid);
  if (!DEVICE_RE.test(deviceId)) return withCorrelation(NextResponse.json({ error: 'deviceId must be a 4-64 character slug' }, { status: 400 }), cid);

  const day = new Date().toISOString().slice(0, 10);
  const path = `${auth.user.id}/${day}/${deviceId}/${name}`;

  const admin = getSupabaseAdmin();
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { expiresIn: SIGNED_UPLOAD_TTL_SECONDS });
  if (signErr || !signed) {
    const missing = /bucket not found|not found/i.test(signErr?.message || '');
    return withCorrelation(
      NextResponse.json(
        {
          error: missing
            ? `Bucket "${BUCKET}" does not exist on this project. Create it as a PRIVATE bucket in the Supabase dashboard (docs/NEEDS_KOREY.md).`
            : `Could not sign the upload — ${signErr?.message || 'no signed URL returned'}`,
        },
        { status: missing ? 503 : 500 }
      ),
      cid
    );
  }
  return withCorrelation(
    NextResponse.json({ bucket: BUCKET, path, token: signed.token, signedUrl: signed.signedUrl, expiresIn: SIGNED_UPLOAD_TTL_SECONDS }),
    cid
  );
}
