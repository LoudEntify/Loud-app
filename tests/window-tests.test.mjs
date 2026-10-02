// Wraps the existing scripts/window-tests.mjs (which exits non-zero on
// failure) so it runs under `node --test` with everything else in tests/.
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scripts/window-tests.mjs passes', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/window-tests.mjs')], { stdio: 'inherit' });
});
