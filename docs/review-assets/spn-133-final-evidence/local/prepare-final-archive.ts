import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const source = '/tmp/spn133-review/current-ci-ba89b83';
const destination = '/tmp/spn133-review/final-archive-ba89b83';
fs.mkdirSync(destination, { recursive: true });
const retained: Array<{path:string; originalSha256:string; storedSha256:string; compressed:boolean}> = [];
for (const relative of fs.readdirSync(source, { recursive: true }).map(String)) {
  const file = path.join(source, relative);
  if (!fs.statSync(file).isFile()) continue;
  // Keep complete callback event ledgers; raw Chromium traces/source maps are
  // supplementary expiring artifacts, explicitly disclosed in the final record.
  if (/^callbacks-(desktop|mobile)\.zip$/.test(relative) || relative.endsWith('spn113-trace.json.gz')) continue;
  const raw = fs.readFileSync(file);
  const compressed = relative.endsWith('spn113-evidence.json');
  const output = compressed ? zlib.gzipSync(raw, { level: 9 }) : raw;
  if (compressed) assert.deepEqual(zlib.gunzipSync(output), raw);
  const target = path.join(destination, relative + (compressed ? '.gz' : ''));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
  retained.push({path: path.relative(destination,target), originalSha256:createHash('sha256').update(raw).digest('hex'),storedSha256:createHash('sha256').update(output).digest('hex'),compressed});
}
fs.writeFileSync(path.join(destination,'retention-manifest.json'),JSON.stringify(retained,null,2)+'\n');
const local = path.join(destination,'local');fs.mkdirSync(local,{recursive:true});
for (const name of ['slice-idle-boundary.log','slice-backlog-check.log','slice-pr-check.log','slice-format.log','inspect-responsiveness.ts','inspect-callbacks.ts','prepare-final-archive.ts']) fs.copyFileSync(path.join('/tmp/spn133-review',name),path.join(local,name));
console.log(JSON.stringify({files:retained.length,destination,compressedLedgers:retained.filter(x=>x.compressed).length}));
