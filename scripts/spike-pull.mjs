#!/usr/bin/env node
// scripts/spike-pull.mjs — pull the device-zoom spike's director data
// (docs/DIRECTOR_DATA_SPEC.md) out of the private `director-spike` bucket
// into a local, gitignored folder, keeping the bucket's folder structure:
//
//   spike-data/<artist id>/<YYYY-MM-DD>/<device>/<batch>.ndjson.gz
//   spike-data/<artist id>/<YYYY-MM-DD>/<device>/spike-report-<role>-….json
//
// Run from the repo root with the same .env.local the local Controller
// uses (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, the
// STAGING project):
//
//   node scripts/spike-pull.mjs                       # everything under the one artist in the bucket
//   node scripts/spike-pull.mjs --artist <uuid>       # when the bucket holds more than one artist
//   node scripts/spike-pull.mjs --day 2026-10-12      # one day only
//   node scripts/spike-pull.mjs --out ./somewhere     # another folder (default spike-data/)
//
// It never prints a key, and it skips files already on disk with the
// same size, so re-running only fetches what is new. The service-role
// key is used because the bucket is private with no policies; that key
// stays in .env.local (gitignored) and never leaves this process.
//
// SPIKE ONLY: delete with app/api/spike/* when the spike ends.
// PRD rows 165, 166. S&I: Observability.
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUCKET = 'director-spike';
const PAGE = 100;

/** The handful of KEY=value lines next.js reads from .env.local, without the dotenv dependency. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function parseArgs(argv) {
  const args = { artist: null, day: null, out: 'spike-data' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--artist') args.artist = argv[++i];
    else if (a === '--day') args.day = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (args.day && !/^\d{4}-\d{2}-\d{2}$/.test(args.day)) throw new Error('--day must be YYYY-MM-DD');
  return args;
}

/** One page after another of one folder (storage-js lists one level); stops at the first empty page, so a server that caps pages below PAGE still gets read in full. */
async function listFolder(storage, prefix) {
  const entries = [];
  for (let offset = 0; ;) {
    const { data, error } = await storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    if (!data || data.length === 0) return entries;
    entries.push(...data);
    offset += data.length;
  }
}

/** Every object under `prefix`, recursively: { path, size }. A folder in storage-js is an entry without an id. */
export async function walk(storage, prefix) {
  const files = [];
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of await listFolder(storage, dir)) {
      if (e.name === '.emptyFolderPlaceholder') continue;
      const path = dir ? `${dir}/${e.name}` : e.name;
      if (e.id == null) stack.push(path);
      else files.push({ path, size: e.metadata?.size ?? null });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The artist folders at the bucket root. */
export async function artistFolders(storage) {
  return (await listFolder(storage, '')).filter((e) => e.id == null && e.name !== '.emptyFolderPlaceholder').map((e) => e.name);
}

/**
 * Download what `walk` found into `outDir`, keeping paths. Skips a file
 * already on disk with the same size. Returns { fetched, skipped, bytes }.
 */
export async function pull(storage, files, outDir, { log = () => {} } = {}) {
  let fetched = 0; let skipped = 0; let bytes = 0;
  for (const f of files) {
    const target = join(outDir, f.path);
    if (existsSync(target) && f.size != null && statSync(target).size === f.size) { skipped += 1; continue; }
    const { data, error } = await storage.from(BUCKET).download(f.path);
    if (error) throw new Error(`download ${f.path}: ${error.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buf);
    fetched += 1; bytes += buf.length;
    log(`  ${f.path} (${buf.length} B)`);
  }
  return { fetched, skipped, bytes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('node scripts/spike-pull.mjs [--artist <uuid>] [--day YYYY-MM-DD] [--out spike-data]');
    return;
  }
  const envPath = resolve('.env.local');
  if (!existsSync(envPath)) throw new Error('.env.local not found: run from the repo root with the local Controller\'s .env.local in place');
  const env = { ...parseEnvFile(readFileSync(envPath, 'utf8')), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '?';
  console.log(`bucket ${BUCKET} on project ${ref}`);

  const { createClient } = await import('@supabase/supabase-js');
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage;

  let artist = args.artist;
  if (!artist) {
    const folders = await artistFolders(storage);
    if (folders.length === 0) throw new Error('the bucket is empty: nothing to pull');
    if (folders.length > 1) throw new Error(`the bucket holds ${folders.length} artists; pass --artist <uuid> (one of: ${folders.join(', ')})`);
    artist = folders[0];
  }
  const prefix = args.day ? `${artist}/${args.day}` : artist;
  console.log(`listing ${prefix}/ …`);
  const files = await walk(storage, prefix);
  console.log(`${files.length} file(s)`);
  const outDir = resolve(args.out);
  const r = await pull(storage, files, outDir, { log: console.log });
  console.log(`done: ${r.fetched} fetched (${r.bytes} B), ${r.skipped} already on disk → ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`spike-pull: ${e.message}`); process.exit(1); });
}
