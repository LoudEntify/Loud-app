// scripts/native-expo-drift.mjs: patch-level Expo drift is a warning, every
// other mismatch (major/minor, unreadable versions, a check that cannot run)
// fails the job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, classifyEntry, classifyDrift, parseReport, decide } from '../scripts/native-expo-drift.mjs';

const dep = (packageName, actualVersion, expectedVersionOrRange) => ({ packageName, packageType: 'dependencies', actualVersion, expectedVersionOrRange });
// What `npx expo install --check --json` printed on 13 Oct 2026 (ci run #75, PR #13).
const PATCH_DRIFT = {
  dependencies: [dep('expo', '57.0.27', '~57.0.28'), dep('expo-router', '57.0.25', '~57.0.26'), dep('expo-splash-screen', '57.0.9', '~57.0.10')],
  upToDate: false,
};

test('parseVersion reads plain versions and the usual range prefixes, refuses anything else', () => {
  assert.deepEqual(parseVersion('57.0.27'), [57, 0, 27]);
  assert.deepEqual(parseVersion('~57.0.28'), [57, 0, 28]);
  assert.deepEqual(parseVersion('^1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('>=0.81.4'), [0, 81, 4]);
  assert.equal(parseVersion('*'), null);
  assert.equal(parseVersion('github:expo/expo#main'), null);
  assert.equal(parseVersion(undefined), null);
});

test('classifyEntry: patch drift is a warning, major or minor drift and unreadable versions block', () => {
  assert.equal(classifyEntry(dep('expo', '57.0.27', '~57.0.28')).severity, 'patch');
  assert.equal(classifyEntry(dep('expo', '57.1.0', '~57.0.28')).severity, 'blocking');
  assert.equal(classifyEntry(dep('expo', '56.0.30', '~57.0.28')).severity, 'blocking');
  assert.equal(classifyEntry(dep('react-native', '0.86.1', '0.87.0')).severity, 'blocking', 'a 0.x minor bump is a real upgrade');
  assert.equal(classifyEntry(dep('react-native', '0.86.1', '0.86.3')).severity, 'patch');
  const missing = classifyEntry(dep('expo-camera', undefined, '~57.0.6'));
  assert.equal(missing.severity, 'blocking'); assert.match(missing.why, /not installed/);
  const git = classifyEntry(dep('expo-camera', 'github:foo/bar', '~57.0.6'));
  assert.equal(git.severity, 'blocking'); assert.match(git.why, /not a plain semver/);
  assert.equal(classifyEntry(dep('x', '1.0.0', '*')).severity, 'blocking');
});

test('classifyDrift splits a report; the real 13 Oct report is all patch drift', () => {
  const r = classifyDrift(PATCH_DRIFT.dependencies);
  assert.equal(r.patch.length, 3); assert.equal(r.blocking.length, 0);
  assert.deepEqual(classifyDrift(undefined), { patch: [], blocking: [] });
});

test('parseReport finds the JSON object even behind other output lines', () => {
  const text = 'npm warn deprecated something\n' + JSON.stringify(PATCH_DRIFT, null, 2) + '\n';
  assert.equal(parseReport(text).dependencies.length, 3);
  assert.equal(parseReport('Found outdated dependencies'), null, 'no JSON: not a report');
  assert.equal(parseReport('{"error":"boom"}'), null, 'JSON without dependencies: not a report');
});

test('decide: up to date → exit 0 and no annotations', () => {
  const d = decide({ status: 0, stdout: JSON.stringify({ dependencies: [], upToDate: true }) });
  assert.equal(d.exitCode, 0); assert.deepEqual(d.annotations, []);
});

test('decide: patch drift only → exit 0 with one warning that says how to fix it', () => {
  const d = decide({ status: 1, stdout: JSON.stringify(PATCH_DRIFT) });
  assert.equal(d.exitCode, 0);
  assert.equal(d.annotations.length, 1); assert.equal(d.annotations[0].level, 'warning');
  assert.match(d.annotations[0].message, /expo@57\.0\.27 \(expected ~57\.0\.28\)/);
  assert.match(d.annotations[0].message, /npx expo install --fix/);
  assert.match(d.summary, /warning only/);
});

test('decide: a minor mismatch among patch drift → exit 1, an error for it and the warning still listed', () => {
  const report = { dependencies: [...PATCH_DRIFT.dependencies, dep('react-native', '0.86.1', '0.87.0')], upToDate: false };
  const d = decide({ status: 1, stdout: JSON.stringify(report) });
  assert.equal(d.exitCode, 1);
  assert.deepEqual(d.annotations.map((a) => a.level), ['error', 'warning']);
  assert.match(d.annotations[0].message, /react-native@0\.86\.1 \(expected 0\.87\.0\): minor version differs/);
});

test('decide: the check failing to run or to print JSON is a broken install → exit 1', () => {
  const d = decide({ status: 1, stdout: '', stderr: 'Error: Cannot find module expo/package.json' });
  assert.equal(d.exitCode, 1); assert.equal(d.annotations[0].level, 'error');
  assert.match(d.annotations[0].message, /did not produce a report \(exit 1\)/); assert.match(d.annotations[0].message, /Cannot find module/);
  // a crash with exit 0 and no JSON is still not a pass
  assert.equal(decide({ status: 0, stdout: 'something odd' }).exitCode, 1);
});
