import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const head='968649bdec92469e8761d6e09ed7f6900c79abc0',base='89d93c8b23db65d3fe6a83d1853acc716c024b80',old='7b06d7516c4c386f5a23044e74d0c09b95a5a929';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();const sha=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');git('merge-base','--is-ancestor',base,head);
const changed=git('diff','--name-only',old,head).split('\n');assert.ok(changed.every(p=>p.startsWith('docs/')));
const docs='docs/implementation/evidence/SPN-144-main-integration';const m=JSON.parse(readFileSync(docs+'/local.json','utf8'));assert.equal(m.payloads.length,16);let stored=0,decoded=0;for(const p of m.payloads){const b=readFileSync(docs+'/'+p.file),raw=gunzipSync(b);assert.equal(b.length,p.storedBytes);assert.equal(sha(b),p.storedSha256);assert.equal(raw.length,p.rawBytes);assert.equal(sha(raw),p.rawSha256);stored+=b.length;decoded+=raw.length;}
const raw=(name:string)=>gunzipSync(readFileSync(docs+'/'+name+'.gz')).toString();const w=JSON.parse(raw('spn144-integration-lint-watchdog.json'));assert.equal(w.outcome,'command-passed');assert.equal(w.pressure,'1');assert.equal(w.elapsedMs,17633);assert.equal(w.peakKiB,748208);
assert.match(raw('spn144-integration-pr.log'),/SPN-144/);assert.match(raw('spn144-integration-lint.log'),/0 warnings and 0 errors/);
const before=JSON.parse(git('show',base+':docs/todo/backlog.json')),after=JSON.parse(readFileSync('docs/todo/backlog.json','utf8'));assert.equal(after.next_id,147);assert.equal(before.next_id,147);assert.deepEqual(after.grooming.completed_since,[...before.grooming.completed_since,'SPN-144']);const expected=structuredClone(before);expected.grooming.completed_since.push('SPN-144');assert.deepEqual(after,expected);
for(const path of ['docs/todo/SPN-145.md','docs/todo/SPN-146.md','docs/todo/SPN-089.md','docs/implementation/SPN-145.md','docs/implementation/SPN-146.md'])assert.equal(git('rev-parse',base+':'+path),git('rev-parse',head+':'+path));
assert.equal(git('diff','--name-only',base,head,'--','docs/todo').split('\n').sort().join('\n'),['docs/todo/SPN-141.md','docs/todo/SPN-144.md','docs/todo/backlog.json','docs/todo/readme.md'].sort().join('\n'));
const proof={head,base,previousAcceptedSource:old,tree:git('rev-parse','HEAD^{tree}'),clean:true,baseAncestor:true,nonDocumentationDeltaFromAcceptedSource:[],verifiedPayloads:16,storedBytes:stored,decodedBytes:decoded,allStoredAndRawSha256Match:true,inheritedRegistrationsByteIdentical:true,landingLedgerOnlyAppends144:true,lint:{elapsedMs:w.elapsedMs,peakKiB:w.peakKiB,pressure:w.pressure,outcome:w.outcome},hostedNewSourceAcceptance:'pending',outcome:'passed'};writeFileSync('/tmp/spn144-integration-review-proof-a.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
