import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root='/tmp/spinel-socket-closure-registration/review-packet-a2f3bac3';
const cwd='/Users/mxbaylee/projects/spinel-socket-closure-registration';
const read=(p:string)=>fs.readFileSync(`${root}/${p}`);
const hash=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(read('manifest.json').toString());
const git=(...args:string[])=>execFileSync('git',args,{cwd,maxBuffer:8*1024*1024});
assert.equal(git('rev-parse','HEAD').toString().trim(),manifest.source);
assert.equal(git('status','--porcelain').length,0);
let exact=0;const masked:any[]=[];
for(const file of manifest.files){const b=read(file.path);assert.equal(b.length,file.bytes);assert.equal(hash(b),file.sha256);const parts=file.path.split('/');if(parts[0]==='candidate'||parts[0]==='base'){const source=parts.shift()==='candidate'?manifest.source:manifest.base;const p=parts.join('/');const original=git('show',`${source}:${p}`);if(p==='docs/implementation/grooming-2026-10-26.md'){const before=original.toString().split('\n'),after=b.toString().split('\n');assert.equal(before.length,after.length);const changes=before.flatMap((s,i)=>s===after[i]?[]:[{line:i+1,before:s,after:after[i]}]);assert.equal(changes.length,2);masked.push({path:file.path,changes});}else{assert.deepEqual(b,original,file.path);exact++;}}}
assert.deepEqual(read('full.diff'),git('diff','--binary','--full-index',manifest.base,manifest.source));
const base=JSON.parse(git('show',`${manifest.base}:docs/todo/backlog.json`).toString());const head=JSON.parse(git('show',`${manifest.source}:docs/todo/backlog.json`).toString());assert.equal(base.next_id,161);assert.equal(head.next_id,162);head.next_id=161;assert.deepEqual(head,base);
const result={at:new Date().toISOString(),source:manifest.source,base:manifest.base,manifestSHA:hash(read('manifest.json')),payloads:manifest.files.length,exactGitFiles:exact,maskedSupplementaryPolicies:masked,fullDiffSHA:hash(read('full.diff')),counterOnlyChanged:true,scope:'Root read complete candidate records/spec and final scoped diff; corrected derived-report wording, ordinal size wording and allocation provenance before freeze. This packet audit is not a hosted or independent grading result.'};
fs.writeFileSync('/tmp/spn161-registration-root-packet-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
