import { readFileSync, readdirSync, lstatSync, writeFileSync, createReadStream } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir='/tmp/spn128-terminal-d22baa69/archive';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const json=(p:string)=>JSON.parse(readFileSync(join(dir,p),'utf8'));
const streamhash=async(p:string)=>{const h=createHash('sha256');let bytes=0;for await(const b of createReadStream(p)){h.update(b);bytes+=b.length;}return {sha256:h.digest('hex'),bytes};};
const files=(d:string):string[]=>readdirSync(d).flatMap(n=>{const p=join(d,n);assert(!lstatSync(p).isSymbolicLink());return lstatSync(p).isDirectory()?files(p):[relative(dir,p)];});
const m=json('manifest.json');assert.equal(m.acceptance,'NOT_ACCEPTED');assert.equal(m.files.length,1209);
assert.equal(hash(readFileSync(join(dir,'manifest.json'))),'b366ec8d7ea3985016d1a836199409e5de5edcecec57b9e881e11530f8b58b22');
assert.deepEqual(files(dir).sort(),[...m.files.map((e:any)=>e.path),'manifest.json'].sort());
for(const e of m.files){const b=readFileSync(join(dir,e.path));assert.equal(b.length,e.bytes);assert.equal(hash(b),e.sha256);}
const bindings=json('collection-bindings.json');assert.equal(bindings.length,763);
for(const e of bindings){const b=readFileSync(join(dir,e.retainedPath));assert.equal(b.length,e.retainedBytes);assert.equal(hash(b),e.retainedSha256);const original=readFileSync(e.original);assert.equal(original.length,e.originalBytes);assert.equal(hash(original),e.originalSha256);assert.deepEqual(e.encoding==='gzip-wrapper-of-original-file'?gunzipSync(b):b,original);}
const artifacts=json('artifact-inventory.json');assert.equal(artifacts.length,35);let members=0,retained=0;
for(const a of artifacts){assert.deepEqual(await streamhash(a.privateOriginalPath),{sha256:a.sha256,bytes:a.bytes});if(a.apiDigest)assert.equal(a.apiDigest,`sha256:${a.sha256}`);for(const e of a.members){members++;if(!e.retainedPath)continue;retained++;const b=readFileSync(join(dir,e.retainedPath));assert.equal(b.length,e.retainedBytes);assert.equal(hash(b),e.retainedSha256);if(e.retainedEncoding==='complete-original-zip'){assert.equal(hash(b),a.sha256);}else{const decoded=e.retainedEncoding==='gzip-wrapper-of-original-member-bytes'?gunzipSync(b):b;assert.equal(decoded.length,e.bytes);assert.equal(hash(decoded),e.sha256);}}}
assert.equal(members,3612);
const terminal=json('independent-audit/independent-terminal-audit.json');assert.equal(terminal.verdict,'NOT_ACCEPTED');assert(terminal.allTerminal);assert.deepEqual(terminal.jobCounts,{total:47,success:43,failure:2,skipped:2});
assert.deepEqual(terminal.gates.filter((x:any)=>x.conclusion!=='success').map((x:any)=>x.name),['Playwright smoke']);
for(const l of terminal.logs){const b=readFileSync(l.path);assert.equal(hash(b),l.gzipSha256);const raw=gunzipSync(b);assert.equal(raw.length,l.rawBytes);assert.equal(hash(raw),l.rawSha256);}
const result={at:new Date().toISOString(),source:m.source,manifestSha256:hash(readFileSync(join(dir,'manifest.json'))),payloads:m.files.length,originalBindings:bindings.length,originalZipHashes:artifacts.length,memberIdentities:members,retainedMemberHashes:retained,decodedJobLogs:terminal.logs.length,acceptance:terminal.verdict,gitBlobsVerified:false};
writeFileSync('/tmp/spn128-root-final-stage-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
