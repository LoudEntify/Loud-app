#!/usr/bin/env node
// scripts/dev/local-stack.mjs
// ─────────────────────────────────────────────────────────────
// A local stand-in for a Supabase project, for running the real app and
// the end-to-end tests against the real migrations with no Docker and no
// staging secrets.
//
// It starts PostgREST (the real thing, static binary from
// scripts/dev/fetch-postgrest.sh) against DATABASE_URL, and a tiny HTTP
// front door on PORT (default 54321, like `supabase start`) that routes:
//
//   /rest/v1/*       → PostgREST (unchanged; real RLS, real JWT roles)
//   /auth/v1/*       → a FAKE GoTrue: only the endpoints the app uses
//                      (signup, token?grant_type=password, user, logout,
//                      admin/users). Passwords are hashed with scrypt,
//                      users live in auth.users, tokens are HS256 JWTs
//                      signed with the same secret PostgREST verifies.
//   /realtime/v1/*   → 404 (the app falls back to polling)
//   /storage/v1/*    → 501
//
// It prints the three values the app needs (URL, anon key, service key)
// and, with --write-env, writes them to .env.local.
//
// THIS IS A TEST DOUBLE. It is never deployed, never points at staging or
// production, and its JWT secret is a fixed local string.
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/loudentify_test';
const PORT = Number(process.env.LOCAL_STACK_PORT || 54321);
const PGRST_PORT = Number(process.env.PGRST_PORT || 3011);
const JWT_SECRET = process.env.LOCAL_JWT_SECRET || 'loudentify-local-only-jwt-secret-not-for-any-real-project';
const WRITE_ENV = process.argv.includes('--write-env');

// ── JWT (HS256) ───────────────────────────────────────────────
const b64 = (s) => Buffer.from(s).toString('base64url');
function signJwt(claims, ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + ttlSec, iss: `http://localhost:${PORT}/auth/v1`, ...claims };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return { token: `${head}.${body}.${sig}`, payload };
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (sig.length !== parts[2].length || !timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
const ANON_KEY = signJwt({ role: 'anon', ref: 'local' }, 10 * 365 * 86400).token;
const SERVICE_KEY = signJwt({ role: 'service_role', ref: 'local' }, 10 * 365 * 86400).token;

// ── PostgREST ─────────────────────────────────────────────────
const dbUrl = new URL(DATABASE_URL);
const pgrstConf = `
db-uri = "postgres://authenticator:authenticator@${dbUrl.hostname}:${dbUrl.port || 5432}${dbUrl.pathname}"
db-schemas = "public, graphql_public"
db-anon-role = "anon"
db-pool = 10
server-port = ${PGRST_PORT}
server-host = "127.0.0.1"
jwt-secret = "${JWT_SECRET}"
jwt-aud = ""
log-level = "warn"
db-prepared-statements = false
`;
const confPath = path.join(ROOT, '.cache', 'postgrest.conf');
fs.mkdirSync(path.dirname(confPath), { recursive: true });
fs.writeFileSync(confPath, pgrstConf);
const pgrstBin = process.env.POSTGREST_BIN || path.join(ROOT, '.cache', 'postgrest');
if (!fs.existsSync(pgrstBin)) {
  console.error(`PostgREST binary not found at ${pgrstBin}. Run scripts/dev/fetch-postgrest.sh first.`);
  process.exit(1);
}
const pgrst = spawn(pgrstBin, [confPath], { stdio: ['ignore', 'inherit', 'inherit'] });
pgrst.on('exit', (code) => { console.error(`postgrest exited with ${code}`); process.exit(code || 1); });

// ── DB (for the fake auth) ────────────────────────────────────
const pool = new pg.Pool({ connectionString: DATABASE_URL });

function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const got = scryptSync(pw, salt, 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
function userShape(row) {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: row.email_confirmed_at,
    app_metadata: row.raw_app_meta_data || { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data || {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function session(row) {
  const { token, payload } = signJwt({ sub: row.id, email: row.email, role: 'authenticated', aud: 'authenticated', user_metadata: row.raw_user_meta_data || {}, app_metadata: row.raw_app_meta_data || {} });
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, refresh_token: randomUUID(), user: userShape(row) };
}
async function createUser({ email, password, user_metadata, email_confirm }) {
  const existing = await pool.query('select id from auth.users where lower(email) = lower($1)', [email]);
  if (existing.rowCount) return { error: { code: 422, msg: 'User already registered' } };
  const id = randomUUID();
  const { rows } = await pool.query(
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [id, email, hashPassword(password || randomUUID()), email_confirm === false ? null : new Date(), user_metadata || {}, { provider: 'email', providers: ['email'] }],
  );
  return { row: rows[0] };
}

// ── HTTP front door ───────────────────────────────────────────
function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range, x-correlation-id',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-correlation-id',
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function callerRole(req) {
  const claims = verifyJwt(bearer(req) || req.headers.apikey);
  return claims?.role || null;
}

async function handleAuth(req, res, url) {
  const p = url.pathname.replace(/^\/auth\/v1/, '');
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.method === 'POST' && p === '/signup') {
    const body = await readJson(req);
    if (!body.email || !body.password) return send(res, 400, { code: 400, msg: 'email and password required' });
    const r = await createUser({ email: body.email, password: body.password, user_metadata: body.data || {} });
    if (r.error) return send(res, r.error.code, r.error);
    return send(res, 200, session(r.row));
  }
  if (req.method === 'POST' && p === '/token') {
    const body = await readJson(req);
    if (url.searchParams.get('grant_type') !== 'password') return send(res, 400, { error: 'unsupported_grant_type' });
    const { rows } = await pool.query('select * from auth.users where lower(email) = lower($1)', [body.email || '']);
    // Seeded synthetic accounts (scripts/db/seed-synthetic.sql) have no
    // password hash; the fixed test password opens them. LOCAL ONLY.
    const synthetic = rows.length && !rows[0].encrypted_password && /@synthetic\.loudentify\.invalid$/.test(rows[0].email || '') && body.password === 'synthetic-pass';
    if (!rows.length || (!synthetic && !checkPassword(body.password || '', rows[0].encrypted_password))) {
      return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [rows[0].id]);
    return send(res, 200, session(rows[0]));
  }
  if (req.method === 'GET' && p === '/user') {
    const claims = verifyJwt(bearer(req));
    if (!claims?.sub) return send(res, 401, { code: 401, msg: 'invalid JWT' });
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
    if (!rows.length) return send(res, 401, { code: 401, msg: 'user not found' });
    return send(res, 200, userShape(rows[0]));
  }
  if (req.method === 'POST' && p === '/logout') return send(res, 204);
  if (p === '/admin/users' && req.method === 'POST') {
    if (callerRole(req) !== 'service_role') return send(res, 401, { code: 401, msg: 'service role required' });
    const body = await readJson(req);
    const r = await createUser({ email: body.email, password: body.password, user_metadata: body.user_metadata || {}, email_confirm: body.email_confirm });
    if (r.error) return send(res, r.error.code, r.error);
    return send(res, 200, userShape(r.row));
  }
  const adminUser = p.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
  if (adminUser && req.method === 'DELETE') {
    if (callerRole(req) !== 'service_role') return send(res, 401, { code: 401, msg: 'service role required' });
    await pool.query('delete from auth.users where id = $1', [adminUser[1]]);
    return send(res, 200, {});
  }
  return send(res, 404, { code: 404, msg: `fake gotrue: no route for ${req.method} ${p}` });
}

function proxyRest(req, res, url) {
  const target = url.pathname.replace(/^\/rest\/v1/, '') + url.search;
  const headers = { ...req.headers, host: `127.0.0.1:${PGRST_PORT}` };
  // supabase-js sends apikey + Authorization; PostgREST only reads Authorization.
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ host: '127.0.0.1', port: PGRST_PORT, path: target || '/', method: req.method, headers }, (ur) => {
    res.writeHead(ur.statusCode, { ...ur.headers, 'access-control-allow-origin': '*' });
    ur.pipe(res);
  });
  up.on('error', (e) => send(res, 502, { message: `postgrest unreachable: ${e.message}` }));
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'OPTIONS' && !url.pathname.startsWith('/rest/v1')) return send(res, 204);
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url);
    if (url.pathname.startsWith('/realtime/v1')) return send(res, 404, { message: 'realtime not available in the local stack' });
    if (url.pathname.startsWith('/storage/v1')) return send(res, 501, { message: 'storage not available in the local stack' });
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    console.error('[local-stack]', e);
    return send(res, 500, { message: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=http://localhost:${PORT}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}`,
    `LOUDENTIFY_LOCAL_STACK=1`,
  ].join('\n');
  if (WRITE_ENV) {
    fs.writeFileSync(path.join(ROOT, '.env.local'), env + '\n');
    console.log(`wrote .env.local for the local stack`);
  }
  console.log(`local stack on http://localhost:${PORT} (postgrest on ${PGRST_PORT}, db ${dbUrl.pathname})`);
  if (!WRITE_ENV) console.log(env);
});
process.on('SIGINT', () => { pgrst.kill(); process.exit(0); });
process.on('SIGTERM', () => { pgrst.kill(); process.exit(0); });
