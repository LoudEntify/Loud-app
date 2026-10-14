#!/usr/bin/env node
// scripts/native-expo-drift.mjs — the CI gate for `expo install --check`
// in native/, with a sense of proportion.
//
// `npx expo install --check` exits 1 for ANY version that differs from
// what the installed Expo SDK expects, including a patch release Expo
// published yesterday. That made the `native` CI job go red on every
// branch the day after a routine Expo patch, with nothing in the branch
// to blame (docs/DECISIONS.md 2026-10-14). This script runs the same
// check with `--json`, then decides:
//
//   patch drift only   (57.0.27 vs ~57.0.28)  → a GitHub WARNING annotation
//                                                and a step-summary line,
//                                                exit 0; fix it in its own
//                                                PR with `npx expo install
//                                                --fix` when convenient.
//   anything else      major or minor mismatch, a version that cannot be
//                      read, a missing package, the check itself failing
//                      to run or to print JSON (a broken install)
//                                             → an ERROR annotation, exit 1.
//
// Only the drift check is softened. `expo-doctor` and the `expo export`
// bundle compile that follow it in .github/workflows/ci.yml still fail
// the job on their own.
//
//   node scripts/native-expo-drift.mjs            # runs the check in native/
//   node scripts/native-expo-drift.mjs path/to/app
//
// The classifier is exported and unit-tested (tests/native-expo-drift.test.mjs).
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** "~57.0.28", "^1.2.3", ">=1.2.3", "1.2.3" → [1, 2, 3]; anything else (git urls, *, tags) → null. */
export function parseVersion(v) {
  const m = /^\s*[~^>=<v\s]*(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * One entry of `expo install --check --json`'s `dependencies` →
 * { severity: 'patch' | 'blocking', ...entry, why }.
 */
export function classifyEntry(dep) {
  const actual = parseVersion(dep?.actualVersion);
  const expected = parseVersion(dep?.expectedVersionOrRange);
  const label = `${dep?.packageName ?? '?'}@${dep?.actualVersion ?? 'missing'} (expected ${dep?.expectedVersionOrRange ?? '?'})`;
  if (!actual) return { severity: 'blocking', label, why: dep?.actualVersion ? 'installed version is not a plain semver' : 'package is not installed' };
  if (!expected) return { severity: 'blocking', label, why: 'expected version is not a plain semver range' };
  if (actual[0] !== expected[0]) return { severity: 'blocking', label, why: 'major version differs' };
  if (actual[1] !== expected[1]) return { severity: 'blocking', label, why: 'minor version differs' };
  return { severity: 'patch', label, why: 'patch version differs' };
}

/** The whole report → { patch: [...], blocking: [...] }. */
export function classifyDrift(dependencies) {
  const out = { patch: [], blocking: [] };
  for (const dep of Array.isArray(dependencies) ? dependencies : []) {
    const c = classifyEntry(dep);
    out[c.severity].push(c);
  }
  return out;
}

/** Parse the CLI's stdout (the JSON object may be preceded by other lines). Returns null when there is no JSON. */
export function parseReport(stdout) {
  const text = String(stdout ?? '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(start));
    return Array.isArray(parsed?.dependencies) ? parsed : null;
  } catch { return null; }
}

/**
 * Decide the outcome from the check's exit code and stdout.
 * → { exitCode, annotations: [{ level, message }], summary }
 */
export function decide({ status, stdout, stderr = '' }) {
  const report = parseReport(stdout);
  if (status === 0 && report && report.upToDate !== false) {
    return { exitCode: 0, annotations: [], summary: 'Expo dependencies are at the versions the SDK expects.' };
  }
  if (!report) {
    const tail = `${stdout}\n${stderr}`.trim().split('\n').slice(-12).join('\n');
    return { exitCode: 1, annotations: [{ level: 'error', message: `expo install --check did not produce a report (exit ${status}): the native install is broken.\n${tail}` }], summary: `expo install --check failed to run (exit ${status}).` };
  }
  const { patch, blocking } = classifyDrift(report.dependencies);
  const annotations = [];
  for (const b of blocking) annotations.push({ level: 'error', message: `Expo dependency mismatch: ${b.label}: ${b.why}.` });
  if (patch.length) annotations.push({ level: 'warning', message: `Expo patch drift (not blocking): ${patch.map((p) => p.label).join(', ')}. Fix in its own PR: cd native && npx expo install --fix.` });
  const lines = [];
  if (blocking.length) lines.push(`❌ ${blocking.length} blocking Expo dependency mismatch(es): ${blocking.map((b) => `${b.label} (${b.why})`).join('; ')}`);
  if (patch.length) lines.push(`⚠️ ${patch.length} patch-level drift(s), warning only: ${patch.map((p) => p.label).join(', ')}`);
  return { exitCode: blocking.length ? 1 : 0, annotations, summary: lines.join('\n') };
}

function main() {
  const dir = resolve(process.argv[2] || 'native');
  const r = spawnSync('npx', ['expo', 'install', '--check', '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } });
  if (r.error) {
    console.log(`::error::could not run expo install --check in ${dir}: ${r.error.message}`);
    process.exit(1);
  }
  const d = decide({ status: r.status, stdout: r.stdout, stderr: r.stderr });
  for (const a of d.annotations) console.log(`::${a.level} title=Expo dependencies::${a.message.replace(/\n/g, '%0A')}`);
  console.log(d.summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Expo dependencies\n\n${d.summary}\n`); } catch { /* summary is a nicety */ }
  }
  process.exit(d.exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
