import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const script = String.raw`
ObjC.bindFunction('dlopen', ['void*', ['char*', 'int']]);
ObjC.bindFunction('dlerror', ['void*', []]);
var openImage = $.dlopen, imageError = $.dlerror, samePointer = Ref.equals;
imageError();
var noError = imageError();
var missing = openImage('/SPINEL-INTENTIONAL-NONEXISTENT-LIBRARY', 1);
var problem = imageError();
var reset = imageError();
if (!samePointer(noError, missing) || !samePointer(noError, reset) || samePointer(noError, problem))
  throw new Error('Opaque null/error discrimination failed');
var loaded = openImage('/System/Library/Frameworks/AppKit.framework/AppKit', 1);
var loadError = imageError();
if (!samePointer(noError, loadError) || samePointer(noError, loaded))
  throw new Error('Fixed system image did not load');
var runningClass = $.NSClassFromString($('NSRunningApplication'));
if (runningClass.isNil()) throw new Error('Expected class unavailable after loading');
JSON.stringify({ missingHandleIsNull: samePointer(noError, missing), errorIsNonNull: !samePointer(noError, problem), resetIsNull: samePointer(noError, reset), loadedHandleIsNonNull: !samePointer(noError, loaded), loadErrorIsNull: samePointer(noError, loadError), classAvailable: true });
`;
writeFileSync('/tmp/spn123-production-inventory/pointer-equality.txt', script);
const started = Date.now();
try {
  const stdout = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' });
  const result = JSON.parse(stdout); assert.ok(Object.values(result).every(value => value === true));
  writeFileSync('/tmp/spn123-production-inventory/pointer-equality.json', JSON.stringify({ durationMs: Date.now() - started, result, scope: 'local ARM bridge and fixed system image only; no Safari process or Apple Events' }, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  const e = error as Error & { stderr?: string; signal?: string; status?: number };
  writeFileSync('/tmp/spn123-production-inventory/pointer-equality.json', JSON.stringify({ durationMs: Date.now() - started, failed: true, message: e.message, stderr: String(e.stderr ?? ''), signal: e.signal, status: e.status }, null, 2) + '\n');
  throw error;
}
