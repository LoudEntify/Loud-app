// scripts/spike-pull.mjs against a fake storage client: the recursive
// walk, the download-and-skip logic, the .env.local parser and the args.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnvFile, parseArgs, walk, artistFolders, pull, BUCKET } from '../scripts/spike-pull.mjs';

// A bucket shaped like the real one: <artist>/<day>/<device>/<file>.
const TREE = {
  '': [{ name: 'artist-a' }, { name: 'artist-b' }, { name: '.emptyFolderPlaceholder', id: 'x' }],
  'artist-a': [{ name: '2026-10-12' }, { name: '2026-10-13' }],
  'artist-a/2026-10-12': [{ name: 'motorola-moto-g35-5g-abc' }, { name: 'web-chrome-154-mac-10-15' }],
  'artist-a/2026-10-12/motorola-moto-g35-5g-abc': [
    { name: 'motorola-moto-g35-5g-abc-ses-1-1-40.ndjson.gz', id: 'f1', metadata: { size: 3 } },
    { name: 'motorola-moto-g35-5g-abc-ses-1-41-80.ndjson.gz', id: 'f2', metadata: { size: 4 } },
  ],
  'artist-a/2026-10-12/web-chrome-154-mac-10-15': [{ name: 'spike-report-controller-web-chrome-154-mac-10-15-1.json', id: 'f3', metadata: { size: 2 } }],
  'artist-a/2026-10-13': [{ name: 'motorola-moto-g35-5g-abc' }],
  'artist-a/2026-10-13/motorola-moto-g35-5g-abc': [{ name: 'spike-report-camera-motorola-moto-g35-5g-abc-2.json', id: 'f4', metadata: { size: 5 } }],
  'artist-b': [],
};
const BODY = { f1: 'abc', f2: 'abcd', f3: 'ab', f4: 'abcde' };

function fakeStorage({ pageSize = 100 } = {}) {
  const downloads = [];
  const api = {
    async list(prefix, { limit, offset }) {
      const all = TREE[prefix] ?? [];
      return { data: all.slice(offset, offset + Math.min(limit, pageSize)), error: null };
    },
    async download(path) {
      downloads.push(path);
      const name = path.split('/').pop();
      const entry = Object.values(TREE).flat().find((e) => e.name === name && e.id);
      if (!entry) return { data: null, error: { message: 'not found' } };
      const text = BODY[entry.id];
      return { data: { arrayBuffer: async () => new TextEncoder().encode(text).buffer }, error: null };
    },
  };
  return { storage: { from(bucket) { assert.equal(bucket, BUCKET); return api; } }, downloads };
}

test('parseEnvFile reads KEY=value lines, quotes, comments and blanks like next.js does', () => {
  const env = parseEnvFile('# comment\n\nNEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY="sb_secret_abc"\nBAD LINE\n=novalue\nX=\'y\'\n');
  assert.deepEqual(env, { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc', X: 'y' });
});

test('parseArgs: artist, day, out; rejects unknown flags and bad dates', () => {
  assert.deepEqual(parseArgs([]), { artist: null, day: null, out: 'spike-data' });
  assert.deepEqual(parseArgs(['--artist', 'u1', '--day', '2026-10-12', '--out', 'x']), { artist: 'u1', day: '2026-10-12', out: 'x' });
  assert.throws(() => parseArgs(['--day', '12/10/2026']), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('walk lists every object under a prefix recursively, folders are entries without an id, placeholder skipped', async () => {
  const { storage } = fakeStorage();
  const files = await walk(storage, 'artist-a');
  assert.deepEqual(files.map((f) => f.path), [
    'artist-a/2026-10-12/motorola-moto-g35-5g-abc/motorola-moto-g35-5g-abc-ses-1-1-40.ndjson.gz',
    'artist-a/2026-10-12/motorola-moto-g35-5g-abc/motorola-moto-g35-5g-abc-ses-1-41-80.ndjson.gz',
    'artist-a/2026-10-12/web-chrome-154-mac-10-15/spike-report-controller-web-chrome-154-mac-10-15-1.json',
    'artist-a/2026-10-13/motorola-moto-g35-5g-abc/spike-report-camera-motorola-moto-g35-5g-abc-2.json',
  ]);
  assert.equal(files[0].size, 3);
  const day = await walk(storage, 'artist-a/2026-10-13');
  assert.equal(day.length, 1);
  assert.deepEqual(await artistFolders(storage), ['artist-a', 'artist-b']);
  // paging: a one-entry page size still finds everything
  const paged = await walk(fakeStorage({ pageSize: 1 }).storage, 'artist-a');
  assert.equal(paged.length, 4);
});

test('pull keeps the folder structure and skips files already on disk with the same size', async () => {
  const { storage, downloads } = fakeStorage();
  const out = mkdtempSync(join(tmpdir(), 'spike-pull-'));
  const files = await walk(storage, 'artist-a');
  const first = await pull(storage, files, out);
  assert.deepEqual(first, { fetched: 4, skipped: 0, bytes: 14 });
  const p = join(out, 'artist-a/2026-10-13/motorola-moto-g35-5g-abc/spike-report-camera-motorola-moto-g35-5g-abc-2.json');
  assert.ok(existsSync(p)); assert.equal(readFileSync(p, 'utf8'), 'abcde');
  const again = await pull(storage, files, out);
  assert.deepEqual(again, { fetched: 0, skipped: 4, bytes: 0 });
  assert.equal(downloads.length, 4, 'nothing re-downloaded');
  // a file of the wrong size on disk is fetched again
  mkdirSync(join(out, 'artist-a/2026-10-12/web-chrome-154-mac-10-15'), { recursive: true });
  writeFileSync(join(out, 'artist-a/2026-10-12/web-chrome-154-mac-10-15/spike-report-controller-web-chrome-154-mac-10-15-1.json'), 'stale!');
  const third = await pull(storage, files, out);
  assert.equal(third.fetched, 1); assert.equal(third.skipped, 3);
});
