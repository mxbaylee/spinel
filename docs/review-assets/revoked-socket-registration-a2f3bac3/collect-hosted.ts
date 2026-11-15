import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const source = 'a2f3bac37c084b8f9fbf163d562c96dae4aff8ef';
const base = '8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d';
const repo = 'repos/mxbaylee/spinel';
const ids = { ci: 43662407000, storybook: 43662407002 };
const mode = process.argv[2]; assert(['snapshot','terminal'].includes(mode));
const dir = `/tmp/spinel-socket-closure-registration/hosted/${new Date().toISOString().replace(/[:.]/g,'-')}-${mode}`;
mkdirSync(dir,{recursive:true});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const requests: unknown[] = [];
const save = (name: string,data: Buffer | string) => writeFileSync(join(dir,name),data,{flag:'wx'});
function call(args: string[], name: string, allowed = [0]): Buffer {
 const start=Date.now();
 const result=spawnSync('gh',args,{encoding:null,timeout:30000,maxBuffer:64*1024*1024});
 const stdout=result.stdout??Buffer.alloc(0),stderr=result.stderr??Buffer.alloc(0);
 save(name,stdout);if(stderr.length)save(name+'.stderr',stderr);
 requests.push({args,name,code:result.status,signal:result.signal,error:result.error?.message,elapsedMs:Date.now()-start,bytes:stdout.length,sha256:sha(stdout)});
 writeFileSync(join(dir,'requests.json'),JSON.stringify(requests,null,2)+'\n');
 assert(result.status!==null&&allowed.includes(result.status),`GET failed: ${name}; retained output, no retry`);
 return stdout;
}
const api=(endpoint:string,name:string)=>JSON.parse(call(['api','--method','GET',`${repo}/${endpoint}`],name).toString());
const pr=api('pulls/293','pr-293.json');assert.equal(pr.head.sha,source);assert.equal(pr.base.sha,base);
const runs:Record<string,any>={},jobs:Record<string,any>={};
for(const [label,id] of Object.entries(ids)) {
 runs[label]=api(`actions/runs/${id}`,`run-${label}.json`);
 assert.equal(runs[label].head_sha,source);assert.equal(runs[label].run_attempt,1);
 jobs[label]=api(`actions/runs/${id}/attempts/1/jobs?per_page=100`,`jobs-${label}.json`);
 assert.equal(jobs[label].jobs.length,jobs[label].total_count,'Refuse incomplete pagination');
}
const checks=JSON.parse(call(['pr','checks','293','--repo','mxbaylee/spinel','--required','--json','name,state,link'],'required-checks.json',[0,1,8]).toString());
const checkRuns=api(`commits/${source}/check-runs?per_page=100`,'check-runs.json');assert.equal(checkRuns.check_runs.length,checkRuns.total_count);
const artifacts=api(`actions/runs/${ids.ci}/artifacts?per_page=100`,'artifacts-ci.json');assert.equal(artifacts.artifacts.length,artifacts.total_count);
const summary:any={at:new Date().toISOString(),source,base,pr:293,mode,runs:Object.fromEntries(Object.entries(runs).map(([label,r])=>[label,{id:r.id,attempt:r.run_attempt,status:r.status,conclusion:r.conclusion}])),checks,jobs:Object.fromEntries(Object.entries(jobs).map(([label,j])=>[label,j.jobs.map((x:any)=>({id:x.id,name:x.name,status:x.status,conclusion:x.conclusion,head_sha:x.head_sha}))]))};
if(mode==='terminal') {
 assert(Object.values(runs).every((r:any)=>r.status==='completed'),'Do not collect terminal evidence while pending');
 const expected=['Backlog','Pull request','Lint','Typecheck','Unit tests','Lib tests','Playwright smoke'];
 assert.deepEqual(checks.map((c:any)=>c.name).sort(),expected.sort());
 // Preserve failures without asserting success; root independently assesses merge eligibility.
 summary.requiredSuccess=checks.every((c:any)=>c.state==='SUCCESS');
 const artifactEvidence=[];
 for(const name of ['ci-plan','ci-results-unit','ci-results-lib','ci-results-browser']) {
  const matches=artifacts.artifacts.filter((a:any)=>a.name===name);assert.equal(matches.length,1);
  const a=matches[0];assert.equal(a.expired,false);
  const zip=call(['api','--method','GET',`${repo}/actions/artifacts/${a.id}/zip`],`artifact-${a.id}.zip`);
  assert.equal(zip.length,a.size_in_bytes);assert.equal('sha256:'+sha(zip),a.digest);
  const path=join(dir,`artifact-${a.id}.zip`);
  const crc=execFileSync('unzip',['-t',path],{timeout:30000,maxBuffer:1024*1024});save(`artifact-${a.id}-crc.txt`,crc);
  const names=execFileSync('unzip',['-Z1',path],{encoding:'utf8',timeout:30000}).trim().split('\n');
  assert.deepEqual(names,[name+'.json']);
  const data=execFileSync('unzip',['-p',path,names[0]],{timeout:30000,maxBuffer:32*1024*1024});save(name+'.json',data);
  artifactEvidence.push({id:a.id,name,zipBytes:zip.length,zipSha256:sha(zip),member:names[0],bytes:data.length,rawSha256:sha(data),canonicalSha256:sha(Buffer.from(JSON.stringify(JSON.parse(data.toString()))))});
 }
 summary.artifacts=artifactEvidence;
 const plan=JSON.parse(readFileSync(join(dir,'ci-plan.json'),'utf8'));summary.plan=plan;
 summary.tested=plan.tested;assert.equal(plan.head,source);assert.equal(plan.base,base);
 const tested=api(`git/commits/${plan.tested}`,'tested-commit.json');
 const sourceCommit=api(`git/commits/${source}`,'source-commit.json');
 summary.sourceTree=sourceCommit.tree.sha;summary.testedTree=tested.tree.sha;summary.sourceTestedTreeEqual=sourceCommit.tree.sha===tested.tree.sha;
 const canonical=sha(Buffer.from(JSON.stringify(plan)));
 for(const group of ['unit','lib','browser']) {
  const result=JSON.parse(readFileSync(join(dir,`ci-results-${group}.json`),'utf8'));
  assert.deepEqual(result.evidence.plan,plan);assert.equal(result.evidence.planSha256,canonical);
 }
 for(const [label,value] of Object.entries(jobs)) for(const job of value.jobs) {
  assert.equal(job.status,'completed');
  if(job.conclusion==='skipped')continue; // Explicit API applicability evidence; skipped jobs have no executed log.
  const raw=call(['api','--method','GET',`${repo}/actions/jobs/${job.id}/logs`],`job-${job.id}.log`);
  save(`job-${job.id}.log.gz`,gzipSync(raw));
 }
}
save('summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({directory:dir,runs:summary.runs,required:checks.map((c:any)=>({name:c.name,state:c.state})),terminal:mode==='terminal'}));
