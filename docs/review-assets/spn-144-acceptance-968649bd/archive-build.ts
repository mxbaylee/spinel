import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root='/tmp/spn144-integrated-hosted', prefix='docs/review-assets/spn-144-acceptance-968649bd';
const identity=JSON.parse(readFileSync(root+'/initial-identity.json','utf8'));
for (const name of ['ci','storybook']) {
  const run=JSON.parse(readFileSync(root+'/'+name+'-run.json','utf8'));
  assert.equal(run.status,'completed'); assert.equal(run.conclusion,'success');
  assert.equal(run.id,identity[name]);
  assert.equal(run.head_sha,identity.source); assert.equal(run.run_attempt,1);
}
const jobs=JSON.parse(readFileSync(root+'/ci-jobs.json','utf8')).jobs;
assert.equal(jobs.length,33);
assert.ok(jobs.every((j:any)=>j.status==='completed' && j.conclusion==='success' && j.head_sha===identity.source && j.run_id===identity.ci && j.run_attempt===1));
const required=['Pull request','Backlog','Lint','Typecheck','Unit tests','Lib tests','Playwright smoke'];
const gates=jobs.filter((j:any)=>required.includes(j.name)); assert.equal(gates.length,7);
assert.deepEqual(gates.map((j:any)=>j.name).sort(),[...required].sort());
writeFileSync(root+'/required-gates.json',JSON.stringify(gates.map((j:any)=>({id:j.id,name:j.name,conclusion:j.conclusion,html_url:j.html_url})),null,2)+'\n');
for(const name of ['desktop-review-a.md','mobile-review-b.md','responsiveness-desktop-review-a.md','responsiveness-mobile-review-b.md','final-readiness-a.md','final-readiness-b.md','README.md','responsiveness-mobile.zip','ci-results-browser.zip']) assert.ok(existsSync(root+'/'+name),name);
const omitted=new Set(['callback-desktop.zip','callback-mobile.zip','SHA256SUMS','ci-current-jobs.json','ci-current-artifacts.json','storybook-current-run.json','storybook-current-jobs.json']);
const files=readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`.slice(root.length+1)).filter(n=>!omitted.has(n)).sort();
assert.ok(files.some(n=>n.startsWith('callback-desktop/')));
assert.ok(files.some(n=>n.startsWith('callback-mobile/')));
assert.ok(!files.some(n=>n.includes('.sqlite')));
const lines:string[]=[];
const digests=new Map<string,{sha256:string;blob:string;bytes:number}>();
for(const name of files){
  const bytes=statSync(root+'/'+name).size;
  assert.ok(bytes<100*1024*1024,name);
  const hash=createHash('sha256');
  const blob=createHash('sha1').update(`blob ${bytes}\0`);
  for await(const chunk of createReadStream(root+'/'+name,{highWaterMark:65536})) {hash.update(chunk);blob.update(chunk);}
  const sha256=hash.digest('hex');
  digests.set(name,{sha256,blob:blob.digest('hex'),bytes});
  lines.push(`${sha256}  ${name}`);
}
for(const [preset,reviewer] of [['desktop','a'],['mobile','b']]) {
  const proof=JSON.parse(readFileSync(root+`/callback-${preset}-members-${reviewer}.json`,'utf8'));
  assert.equal(proof.count,93);assert.equal(proof.retained,81);assert.equal(proof.omitted,12);
  const kept=proof.members.filter((m:any)=>!m.omitted);
  assert.equal(kept.length,81);
  assert.deepEqual(files.filter(n=>n.startsWith(`callback-${preset}/`)).sort(),kept.map((m:any)=>`callback-${preset}/${m.file}`).sort());
  for(const member of kept) {
    const digest=digests.get(`callback-${preset}/${member.file}`);
    assert.equal(digest?.bytes,member.bytes);assert.equal(digest?.sha256,member.sha256);
  }
}
writeFileSync(root+'/SHA256SUMS',lines.join('\n')+'\n');
const env={...process.env,GIT_INDEX_FILE:'/tmp/spn144-integrated-acceptance.index'};
const git=(...args:string[])=>execFileSync('git',args,{env,encoding:'utf8'}).trim();
git('read-tree','--empty');
for(const name of [...files,'SHA256SUMS']) {
  const blob=git('hash-object','-w',root+'/'+name);
  if(name!=='SHA256SUMS')assert.equal(blob,digests.get(name)?.blob,`Input changed while staging: ${name}`);
  git('update-index','--add','--cacheinfo','100644',blob,prefix+'/'+name);
}
const commit=git('commit-tree',git('write-tree'),'-m','Preserve SPN-144 first-attempt acceptance on 968649bd');
const result={commit,prefix,payloads:files.length,bytes:files.reduce((total,name)=>total+statSync(root+'/'+name).size,0),manifestSha256:createHash('sha256').update(readFileSync(root+'/SHA256SUMS')).digest('hex')};
writeFileSync('/tmp/spn144-integrated-acceptance-archive.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
