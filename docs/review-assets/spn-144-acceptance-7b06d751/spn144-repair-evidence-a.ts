import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root='/Users/mxbaylee/projects/spinel-spn-144/docs/implementation/evidence/SPN-144';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
const entries=manifest.entries;assert.equal(entries.length,124);
assert.deepEqual((await readdir(root)).filter(n=>n.endsWith('.gz')).sort(),entries.map((x:any)=>x.file).sort());
let stored=0,decoded=0;const receipts:any[]=[];
for(const e of entries){const bytes=await readFile(root+'/'+e.file);assert.equal(bytes.length,e.storedBytes,e.file);assert.equal(hash(bytes),e.storedSha256,e.file);const raw=gunzipSync(bytes);assert.equal(raw.length,e.originalBytes,e.file);assert.equal(hash(raw),e.originalSha256,e.file);stored+=bytes.length;decoded+=raw.length;
 if(/spn144-(all-callback-controls|lint|typecheck|backlog-index)-watchdog/.test(e.file)){const d=JSON.parse(raw.toString());receipts.push({file:e.file,outcome:d.outcome,elapsedMs:d.elapsedMs,peakKiB:d.peakKiB,pressure:d.pressure});}
 if(/spn144-(all-callback-controls|lint|typecheck|backlog-index)\.log/.test(e.file)) console.log(e.file,raw.toString().slice(-1500));
}
const result={head:'7b06d7516c4c386f5a23044e74d0c09b95a5a929',manifestSha256:hash(await readFile(root+'/manifest.json')),entries:entries.length,storedBytes:stored,decodedBytes:decoded,allHashesMatched:true,receipts};
await writeFile('/tmp/spn144-repair-evidence-a.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
