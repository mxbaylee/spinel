import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/tmp/spn141-after144-posted',prefix='docs/review-assets/spn-141-blocked-receipt-4e593fba';
const read=(name:string)=>JSON.parse(readFileSync(root+'/'+name,'utf8'));
const source='4e593fbaf9ea89585920053b9415f9a8eac0944f',r=read('metadata-run.json'),j=read('metadata-jobs.json').jobs,p=read('pr-after.json');
assert.equal(r.id,41975413888);assert.equal(r.head_sha,source);assert.equal(r.run_attempt,1);assert.equal(r.status,'completed');assert.equal(r.conclusion,'cancelled');
assert.equal(j.length,15);assert.ok(j.every((x:any)=>x.status==='completed'&&x.head_sha===source));
assert.equal(j.filter((x:any)=>x.conclusion==='cancelled').length,13);
assert.deepEqual(j.filter((x:any)=>x.conclusion==='failure').map((x:any)=>x.id),[127073258455]);
assert.deepEqual(j.filter((x:any)=>x.conclusion==='success').map((x:any)=>x.name),['Backlog']);
assert.match(readFileSync(root+'/metadata-typecheck.log','utf8'),/Missing successful applicability decision/);
assert.equal(p.head.sha,source);assert.equal(p.draft,true);assert.equal(p.merged,false);assert.equal(p.state,'open');
assert.equal(p.body,readFileSync(root+'/pr-body.md','utf8'));
assert.equal(readFileSync(root+'/worktree-status.txt','utf8'),'');
const runs=read('runs-final.json').workflow_runs;
assert.equal(runs.length,4);for(const [id,conclusion,attempt] of [[41975413888,'cancelled',1],[41970163093,'failure',1],[41970163073,'success',1],[41970163084,'success',2]]){
 const run=runs.find((x:any)=>x.id===id);assert.ok(run);assert.equal(run.conclusion,conclusion);assert.equal(run.status,'completed');assert.equal(run.run_attempt,attempt);assert.equal(run.head_sha,source);
}
const files=readdirSync(root).filter(n=>n!=='SHA256SUMS').sort();
const sums=files.map(n=>createHash('sha256').update(readFileSync(root+'/'+n)).digest('hex')+'  '+n).join('\n')+'\n';writeFileSync(root+'/SHA256SUMS',sums);
const env={...process.env,GIT_INDEX_FILE:'/tmp/spn141-after144-receipt.index'};
const git=(...args:string[])=>execFileSync('git',args,{env,encoding:'utf8'}).trim();
git('read-tree','--empty');for(const name of [...files,'SHA256SUMS']){const blob=git('hash-object','-w',root+'/'+name);git('update-index','--add','--cacheinfo','100644',blob,prefix+'/'+name);}
const commit=git('commit-tree',git('write-tree'),'-m','Preserve SPN-141 blocked receipt publication and terminal metadata cancellation');
const result={commit,prefix,payloads:files.length,bytes:files.reduce((s,n)=>s+readFileSync(root+'/'+n).length,0),manifestSha256:createHash('sha256').update(sums).digest('hex')};
writeFileSync('/tmp/spn141-after144-receipt-archive.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
