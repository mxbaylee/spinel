import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='/tmp/spn142-first-candidate',prefix='docs/review-assets/spn-142-first-candidate-2b173b29';
const run=JSON.parse(readFileSync(root+'/ci-run-final.json','utf8'));assert.equal(run.conclusion,'success');assert.equal(run.head_sha,'2b173b29b3c0894a45b8d48d92073c3645110673');assert.equal(run.run_attempt,1);
const jobs=JSON.parse(readFileSync(root+'/ci-jobs-final.json','utf8')).flatMap((p:any)=>p.jobs);assert.equal(jobs.length,33);assert.ok(jobs.every((j:any)=>j.conclusion==='success'));
const gates=JSON.parse(readFileSync(root+'/required-gates.json','utf8'));assert.equal(gates.length,7);
for(const id of [41914915215,41921458717,41916757266]){const r=JSON.parse(readFileSync(`${root}/receipt-runs/${id}-run.json`,'utf8'));assert.equal(r.status,'completed');assert.equal(r.conclusion,'cancelled');}
const files=readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`.slice(root.length+1)).filter(n=>!['archive-commit.txt','SHA256SUMS'].includes(n)).sort();assert.ok(!files.some(n=>n.includes('.sqlite')));
writeFileSync(root+'/SHA256SUMS',files.map(n=>`${createHash('sha256').update(readFileSync(root+'/'+n)).digest('hex')}  ${n}`).join('\n')+'\n');
const env={...process.env,GIT_INDEX_FILE:'/tmp/spn142-first-candidate.index'};const git=(...a:string[])=>execFileSync('git',a,{env,encoding:'utf8'}).trim();
git('read-tree','--empty');for(const n of [...files,'SHA256SUMS'])git('update-index','--add','--cacheinfo','100644',git('hash-object','-w',root+'/'+n),prefix+'/'+n);
const commit=git('commit-tree',git('write-tree'),'-m','Preserve SPN-142 first candidate and overlooked receipt failures');writeFileSync(root+'/archive-commit.txt',commit+'\n');console.log(commit);
