// Deterministic process-lifecycle fixture; never used as a trace converter.
import { writeFileSync } from 'node:fs';

const [mode, ready] = process.argv.slice(2);
if (mode === 'complete') {
  process.stderr.write('retained warning\n');
  process.stdout.write('{"traceEvents":[]}');
} else if (mode === 'failed') {
  process.stdout.write('{"traceEvents":[');
  process.stderr.write('original converter failure\n');
  process.exitCode = 7;
} else if (mode === 'stderr-bound') {
  process.stderr.write('x'.repeat(512 * 1024));
} else if (mode === 'stdout-bound') {
  process.stdout.write('x'.repeat(128 * 1024));
} else if (mode === 'query') {
  process.stdout.write('"name","severity","value"\n');
} else if (mode === 'wait') {
  process.on('SIGTERM', () => {});
  process.stdout.write('{"traceEvents":[');
  writeFileSync(ready!, String(process.pid));
  setInterval(() => {}, 1000);
} else throw new Error(`Unknown child fixture mode: ${mode}`);
