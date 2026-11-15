import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/tmp/spn128-body-edit-43658181655';
const sha=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
const read=(p:string)=>fs.readFileSync(path.join(root,p));
const json=(p:string)=>JSON.parse(read(p).toString());
const manifest=json('manifest.json');
assert.equal(sha(read('manifest.json')),'f5174339866ca6e776e8557f8e20e4f6ff859356aa803ea874511d5e0f73fe2f');
for(const f of manifest.files){const b=read(f.path);assert.equal(b.length,f.bytes,f.path);assert.equal(sha(b),f.sha256,f.path);}
const summary=json('summary.json');
assert.equal(summary.conclusion,'cancelled');assert.equal(summary.acceptance,'NOT_ACCEPTED');
assert.equal(summary.jobs.length,32);assert.deepEqual(summary.jobConclusions,{success:5,cancelled:27});
assert.equal(summary.availableJobLogs.length,20);
for(const log of summary.availableJobLogs){const raw=zlib.gunzipSync(read(log.path));assert.equal(raw.length,log.rawBytes);assert.equal(sha(raw),log.rawSha256);}
let members=0;
const zips=json('zip-inventory.json');
for(const zip of zips){const file=path.join(root,zip.path);assert.equal(sha(read(zip.path)),zip.sha256);execFileSync('unzip',['-t',file],{stdio:'pipe',maxBuffer:1024*1024});for(const member of zip.members){const b=execFileSync('unzip',['-p',file,member.name],{maxBuffer:10*1024*1024});assert.equal(b.length,member.bytes,member.name);assert.equal(sha(b),member.sha256,member.name);members++;}}
let bindings=0;
for(const name of ['trigger-bindings.json','force-cancel-bindings.json']){const data=json(name);for(const binding of data.originals??data.records??[]){const original=fs.readFileSync(binding.original);assert.equal(sha(original),binding.sha256);assert.equal(sha(read(binding.path)),binding.sha256);bindings++;}}
const plan=json('actual-ci-plan.json');
const result={observedAt:new Date().toISOString(),run:summary.run,source:summary.source,acceptance:'NOT_ACCEPTED',manifestSHA:sha(read('manifest.json')),payloads:manifest.files.length,individualLogs:20,zips:zips.length,members,originalBindings:bindings,plan,summaryLimits:summary.limits,readerCorrection:'Initial root helper checked seven trigger originals but omitted the two force-cancel bindings because their list is records, not originals. Corrected field selection independently verifies all nine; original evidence unchanged. Initial helper/output was not separately persisted beyond tool history.'};
fs.writeFileSync('/tmp/spn128-root-body-edit-audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,plan:summary.plan}));
