import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const root = '/tmp/spn123-production-inventory';
const observations: unknown[] = [];
// No Application(), Safari process lookup, Apple Events, UI or provider session.
const cases = [
  { name: 'published-string-return', script: "ObjC.bindFunction('dlerror', ['string', []]); $.dlerror();", expected: 'error' },
  { name: 'opaque-null-and-error', script: String.raw`
ObjC.bindFunction('dlopen', ['void*', ['char*', 'int']]);
ObjC.bindFunction('dlerror', ['void*', []]);
var openImage = $.dlopen;
var imageError = $.dlerror;
function shape(value) { return { type: typeof value, isNull: value === null, isUndefined: value === undefined, truthy: !!value, display: Automation.getDisplayString(value) }; }
var clear = imageError();
var missing = openImage('/SPINEL-INTENTIONAL-NONEXISTENT-LIBRARY', 1);
var problem = imageError();
var reset = imageError();
JSON.stringify({ clear: shape(clear), missing: shape(missing), problem: shape(problem), reset: shape(reset) });
`, expected: 'json' },
];
for (const c of cases) {
  writeFileSync(root + '/' + c.name + '.txt', c.script);
  const started = Date.now();
  try {
    const stdout = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', c.script], { timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' });
    assert.equal(c.expected, 'json');
    observations.push({ name: c.name, durationMs: Date.now() - started, outcome: 'returned', value: JSON.parse(stdout) });
  } catch (error) {
    const e = error as Error & { status?: number; signal?: string; stderr?: string };
    observations.push({ name: c.name, durationMs: Date.now() - started, outcome: 'error', status: e.status, signal: e.signal, stderr: String(e.stderr ?? e.message) });
    writeFileSync(root + '/loader-probe.json', JSON.stringify({ source: '5d775fba29a076126ebe3d81ed9232f355b5c6dc', observations }, null, 2) + '\n');
    assert.equal(c.expected, 'error'); assert.match(String(e.stderr), /NULL cString/);
  }
}
writeFileSync(root + '/loader-probe.json', JSON.stringify({ source: '5d775fba29a076126ebe3d81ed9232f355b5c6dc', observations }, null, 2) + '\n');
console.log(JSON.stringify(observations));
