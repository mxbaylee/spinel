import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root='/tmp/spn142-registration-final';
const prefix='docs/review-assets/spn-142-registration-f6943c89';
for(const name of ['ci','storybook']){const r=JSON.parse(readFileSync(`${root}/${name}-run.json`,'utf8'));assert.equal(r.head_sha,'f6943c89da4da3d898523a58ff32037beda5c7e2');assert.equal(r.conclusion,'success');assert.equal(r.run_attempt,1);}
for(const name of ['spn140','spn141']){const r=JSON.parse(readFileSync(`${root}/${name}-receipt-cancel-run.json`,'utf8'));assert.equal(r.status,'completed');assert.equal(r.conclusion,'cancelled');}
const jobs=JSON.parse(readFileSync(`${root}/ci-jobs.json`,'utf8')).jobs;
for(const name of ['Pull request','Backlog','Lint','Typecheck','Unit tests','Lib tests','Playwright smoke'])assert.equal(jobs.find((j:any)=>j.name===name)?.conclusion,'success');
const names=readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`.slice(root.length+1)).filter(n=>!['archive-commit.txt','SHA256SUMS','final-body.md'].includes(n)).sort();
writeFileSync(`${root}/SHA256SUMS`,names.map(n=>`${createHash('sha256').update(readFileSync(`${root}/${n}`)).digest('hex')}  ${n}`).join('\n')+'\n');
const env={...process.env,GIT_INDEX_FILE:'/tmp/spn142-registration-final.index'};
const git=(...a:string[])=>execFileSync('git',a,{env,encoding:'utf8'}).trim();
git('read-tree','--empty');
for(const n of [...names,'SHA256SUMS'])git('update-index','--add','--cacheinfo','100644',git('hash-object','-w',`${root}/${n}`),`${prefix}/${n}`);
const commit=git('commit-tree',git('write-tree'),'-m','Preserve SPN-142 documentation registration acceptance and checkpoint cancellations');
writeFileSync(`${root}/archive-commit.txt`,commit+'\n');console.log(commit);
