import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';
import { distribution,docIdleDurations,DOC_RESPONSIVENESS_BUDGETS } from '/Users/mxbaylee/projects/spinel-spn-144/e2e/doc-responsiveness.ts';
const root='/tmp/spn144-integrated-hosted', checkout='/Users/mxbaylee/projects/spinel-spn-144';
const ids=JSON.parse(readFileSync(root+'/initial-identity.json','utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
assert.equal(execFileSync('git',['rev-parse',ids.source+'^{tree}'],{cwd:checkout,encoding:'utf8'}).trim(),ids.sourceAndTestedTree);assert.equal(execFileSync('git',['rev-parse',ids.tested+'^{tree}'],{cwd:checkout,encoding:'utf8'}).trim(),ids.sourceAndTestedTree);
const zip=readFileSync(root+'/responsiveness-desktop.zip');assert.equal(zip.length,1711679);assert.equal(hash(zip),'1cca41c0e9ee9f8ad41589d210fa6101b584995a79a784618a47d37b17b95813');
const members=execFileSync('unzip',['-Z1',root+'/responsiveness-desktop.zip'],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.endsWith('/'));
const proofs=members.map(file=>{const raw=execFileSync('unzip',['-p',root+'/responsiveness-desktop.zip',file],{maxBuffer:20*1024*1024});const local=readFileSync(root+'/responsiveness-desktop/'+file);assert.deepEqual(local,raw,file);return {file,bytes:raw.length,sha256:hash(raw)};});
const brief=(v:any,depth=0):any=>Array.isArray(v)?{length:v.length,first:depth<3?v.slice(0,2).map(x=>brief(x,depth+1)):undefined}:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,depth<3?brief(x,depth+1):typeof x==='object'?Array.isArray(x)?{length:x.length}:Object.keys(x??{}):x])):typeof v==='string'&&v.length>150?v.slice(0,80)+'…('+v.length+')':v;
const metrics:any[]=[];const boundaries:any[]=[];const reports:any[]=[];
for(const file of members.filter(p=>p.endsWith('.json'))){const m=JSON.parse(readFileSync(root+'/responsiveness-desktop/'+file,'utf8'));
 if(file.endsWith('/spn108-metrics.json')){
  assert.equal(m.attempt,0);assert.equal(m.preset,'desktop');assert.equal(m.completed,true);assert.deepEqual(m.errors,[]);
  assert.equal(m.source,m.role==='candidate'?ids.tested:'2c84a18449c7dae09e2817989fac6236be96ef98');
  for(const [p,h]of Object.entries(m.harnessSha256))assert.equal(hash(execFileSync('git',['show',ids.source+':'+p],{cwd:checkout})),h,p);
  if(m.sample==='profile'){const p=dirname(file)+'/spn108-profile.cpuprofile';assert.equal(proofs.find(v=>v.file===p)!.sha256,m.profileSha256);}
  const capacity=distribution(m.native.flushes.filter((f:any)=>f.reason==='capacity').map((f:any)=>f.durationMs));
  const idle=m.role==='candidate'?distribution(docIdleDurations(m.native)):null;
  const frame=distribution(m.input.keyToFrameMs),tasks=distribution(m.input.longTasks.map((t:any)=>t.durationMs));
  if(m.role==='candidate'&&m.sample!=='profile'){
   assert.equal(m.input.keydownAt.length,2086);assert.equal(m.native.flushes.filter((f:any)=>f.reason==='capacity').length,65);
   assert.ok(capacity.p95<=16&&capacity.max<=50);assert.ok(idle!.p95<=16&&idle!.max<=50);assert.ok(frame.p95<=100&&tasks.max<=200);
   assert.deepEqual(m.native.pending,{history:0,collaboration:0});assert.deepEqual(m.native.highWater,{history:32,collaboration:32});
   assert.ok(m.native.drainWitness.firstEmpty.observedAt-m.input.keydownAt.at(-1)<=1000);assert.ok(Object.values(m.budgetResults).every(v=>v===true));
   assert.deepEqual(m.budgets,DOC_RESPONSIVENESS_BUDGETS.desktop);
  }
  metrics.push({file,role:m.role,sample:m.sample,source:m.source,summary:m.summary,capacity,idle,frame,tasks,budgetResults:m.budgetResults,correctness:m.correctness,preUndoIntegrity:m.preUndoIntegrity,undoRedo:m.undoRedo,finalReloads:m.finalReloads,profileSha256:m.profileSha256,compositionCpu:m.compositionCpu,nativeWitness:brief(m.native.drainWitness),nativeFlushReasons:[...new Set(m.native.flushes.map((f:any)=>f.reason))],nativeKeys:Object.keys(m.native),instrumentation:m.instrumentation,runner:m.runner,browser:m.browser,runtime:m.runtime,playwright:m.playwright});
 }else if(file.endsWith('/spn108-boundaries.json')||file.endsWith('/spn108-post-burst.json'))boundaries.push({file,data:brief(m)});
 else if(file.endsWith('playwright-report/doc-responsiveness.json')){
  const tests:any[]=[];const walk=(s:any)=>{for(const p of s.specs??[])for(const t of p.tests??[])tests.push({title:p.title,status:t.status,results:t.results.map((r:any)=>({status:r.status,retry:r.retry,duration:r.duration,errors:r.errors}))});for(const c of s.suites??[])walk(c);};walk(m);
  assert.equal(tests.length,file.startsWith('baseline-')?4:7);for(const t of tests){assert.equal(t.results.length,1);assert.equal(t.results[0].status,'passed');assert.equal(t.results[0].retry,0);assert.deepEqual(t.results[0].errors,[]);}reports.push({file,stats:m.stats,tests});
 }
}
assert.equal(metrics.length,8);
const comparison=JSON.parse(readFileSync(root+'/responsiveness-desktop/test-results/spn108-comparison-desktop.json','utf8'));assert.equal(comparison.passed,true);assert.deepEqual(comparison.failures,[]);assert.deepEqual(comparison.unavailable,[]);
const clocks=members.filter(p=>p.endsWith('spn108-profile-clock.json')).map(file=>({file,data:JSON.parse(readFileSync(root+'/responsiveness-desktop/'+file,'utf8'))}));
writeFileSync(root+'/responsiveness-desktop-audit-a.json',JSON.stringify({ids,proofs,metrics,boundaries,reports,comparison,clocks},null,2)+'\n');
console.log(JSON.stringify({members:proofs.length,metrics:metrics.length,firstAttemptTests:reports.flatMap(r=>r.tests).length,budgets:metrics.filter(m=>m.role==='candidate').map(m=>({sample:m.sample,capacity:m.capacity,idle:m.idle,frame:m.frame,tasks:m.tasks}))},null,2));
