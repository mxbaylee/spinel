import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root='/tmp/spn141-after144-hosted', prefix='docs/review-assets/spn-141-mobile-blocker-4e593fba';
const identity=JSON.parse(readFileSync(root+'/initial-identity.json','utf8'));
for (const name of ['ci','storybook','native']) {
  const run=JSON.parse(readFileSync(root+'/'+name+'-run.json','utf8'));
  assert.equal(run.status,'completed'); assert.equal(run.conclusion,name==='ci'?'failure':'success');
  assert.equal(run.id,identity[name]);
  assert.equal(run.head_sha,identity.source); assert.equal(run.run_attempt,name==='storybook'?2:1);
}
const storyJobs=JSON.parse(readFileSync(root+'/storybook-jobs.json','utf8')).jobs;
assert.equal(storyJobs.length,10);
assert.ok(storyJobs.every((j:any)=>j.status==='completed' && j.head_sha===identity.source && j.run_id===identity.storybook && j.run_attempt===2));
assert.equal(storyJobs.filter((j:any)=>j.conclusion==='success').length,8);
assert.deepEqual(storyJobs.filter((j:any)=>j.conclusion!=='success').map((j:any)=>[j.name,j.conclusion]).sort(),[['Deploy to GitHub Pages','skipped'],['Publish PR preview to GitHub Pages','skipped']].sort());
const firstStory=JSON.parse(readFileSync(root+'/storybook-attempt1-run.json','utf8'));
assert.equal(firstStory.id,identity.storybook);assert.equal(firstStory.run_attempt,1);assert.equal(firstStory.conclusion,'failure');assert.equal(firstStory.head_sha,identity.source);
assert.ok(existsSync(root+'/storybook-retry-review-b.md'));
const retryProof=JSON.parse(readFileSync(root+'/storybook-retry-review-b.json','utf8'));
assert.equal(retryProof.source,identity.source);assert.equal(retryProof.run,identity.storybook);assert.equal(retryProof.attempt,2);
for(const key of ['accepted','firstAttemptPreserved','failedJobsOnly','carriedSiblingTimestampsVerified'])assert.equal(retryProof[key],true,key);
const jobs=JSON.parse(readFileSync(root+'/ci-jobs.json','utf8')).jobs;
assert.equal(jobs.length,33);
assert.ok(jobs.every((j:any)=>j.status==='completed' && j.head_sha===identity.source && j.run_id===identity.ci && j.run_attempt===1));
assert.equal(jobs.filter((j:any)=>j.conclusion==='success').length,31);
assert.deepEqual(jobs.filter((j:any)=>j.conclusion!=='success').map((j:any)=>[j.id,j.name,j.conclusion]).sort(),[[127056548327,'Doc responsiveness (mobile)','failure'],[127069617826,'Playwright smoke','failure']].sort());
const nativeJobs=JSON.parse(readFileSync(root+'/native-jobs.json','utf8')).jobs;
assert.equal(nativeJobs.length,3);
assert.ok(nativeJobs.every((j:any)=>j.status==='completed' && j.conclusion==='success' && j.head_sha===identity.source && j.run_id===identity.native && j.run_attempt===1));
assert.deepEqual(nativeJobs.map((j:any)=>j.name).sort(),['Native desktop offline (chrome, macos-26)','Native desktop offline (firefox, macos-26)','Native desktop offline (safari, macos-15-intel)'].sort());
const required=['Pull request','Backlog','Lint','Typecheck','Unit tests','Lib tests','Playwright smoke'];
const gates=jobs.filter((j:any)=>required.includes(j.name)); assert.equal(gates.length,7);
assert.deepEqual(gates.map((j:any)=>j.name).sort(),[...required].sort());
writeFileSync(root+'/required-gates.json',JSON.stringify(gates.map((j:any)=>({id:j.id,name:j.name,conclusion:j.conclusion,html_url:j.html_url})),null,2)+'\n');
for(const name of ['desktop-review-a.md','mobile-review-b.md','responsiveness-desktop-review-a.md','responsiveness-mobile-review-b.md','blocked-readiness-a.md','blocked-readiness-b.md','README.md','responsiveness-mobile.zip','ci-results-browser.zip','chrome.zip','firefox.zip','safari.zip','chrome-acceptance-a.md','firefox-acceptance-b.md','safari-acceptance-a.md']) assert.ok(existsSync(root+'/'+name),name);
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
for(const browser of ['chrome','firefox','safari']) {
  const metadata=JSON.parse(readFileSync(root+'/'+browser+'-artifact.json','utf8'));
  assert.equal(metadata.workflow_run.id,identity.native);assert.equal(metadata.workflow_run.head_sha,identity.source);
  assert.equal(digests.get(browser+'.zip')?.bytes,metadata.size_in_bytes);
  assert.equal('sha256:'+digests.get(browser+'.zip')?.sha256,metadata.digest);
  const proofName=browser==='firefox'?'firefox-members-b.json':browser+'-proof-a.json';
  const proof=JSON.parse(readFileSync(root+'/'+proofName,'utf8'));
  const members=proof.members;
  assert.equal(members.length,browser==='chrome'?14:browser==='firefox'?16:17);
  assert.deepEqual(files.filter(n=>n.startsWith(browser+'/')).sort(),members.map((m:any)=>browser+'/'+(m.name??m.file)).sort());
  for(const member of members) {
    const digest=digests.get(browser+'/'+(member.name??member.file));
    assert.equal(digest?.bytes,member.bytes);assert.equal(digest?.sha256,member.sha256);
  }
}
for(const [preset,reviewer] of [['desktop','a'],['mobile','b']]) {
  const key='responsiveness-'+preset;
  const proof=JSON.parse(readFileSync(root+'/'+key+'-members-'+reviewer+'.json','utf8'));
  const metadata=JSON.parse(readFileSync(root+'/'+key+'-artifact.json','utf8'));
  assert.equal(metadata.workflow_run.id,identity.ci);assert.equal(metadata.workflow_run.head_sha,identity.source);
  assert.equal(digests.get(key+'.zip')?.bytes,metadata.size_in_bytes);
  assert.equal('sha256:'+digests.get(key+'.zip')?.sha256,metadata.digest);
  assert.equal(proof.members.length,proof.count);assert.equal(proof.retained,proof.count);assert.equal(proof.omitted,0);assert.equal(proof.count,preset==='desktop'?18:23);
  assert.deepEqual(files.filter(n=>n.startsWith(key+'/')).sort(),proof.members.map((m:any)=>key+'/'+m.file).sort());
  for(const member of proof.members) {
    const digest=digests.get(key+'/'+member.file);
    assert.equal(digest?.bytes,member.bytes);assert.equal(digest?.sha256,member.sha256);
  }
}
writeFileSync(root+'/SHA256SUMS',lines.join('\n')+'\n');
const env={...process.env,GIT_INDEX_FILE:'/tmp/spn141-after144-blocked.index'};
const git=(...args:string[])=>execFileSync('git',args,{env,encoding:'utf8'}).trim();
git('read-tree','--empty');
for(const name of [...files,'SHA256SUMS']) {
  const blob=git('hash-object','-w',root+'/'+name);
  if(name!=='SHA256SUMS')assert.equal(blob,digests.get(name)?.blob,`Input changed while staging: ${name}`);
  git('update-index','--add','--cacheinfo','100644',blob,prefix+'/'+name);
}
const commit=git('commit-tree',git('write-tree'),'-m','Preserve SPN-141 mobile capacity failures and current owner evidence on 4e593fba');
const result={commit,prefix,payloads:files.length,bytes:files.reduce((total,name)=>total+statSync(root+'/'+name).size,0),manifestSha256:createHash('sha256').update(readFileSync(root+'/SHA256SUMS')).digest('hex')};
writeFileSync('/tmp/spn141-after144-blocked-archive.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
