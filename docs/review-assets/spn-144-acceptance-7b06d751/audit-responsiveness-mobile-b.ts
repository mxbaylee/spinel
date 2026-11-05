import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {distribution,docIdleDurations,DOC_RESPONSIVENESS_BUDGETS} from '/Users/mxbaylee/projects/spinel-spn-144/e2e/doc-responsiveness.ts';
const root='/tmp/spn144-hosted',dir=root+'/responsiveness-mobile',repo='/Users/mxbaylee/projects/spinel-spn-144';
const ids=JSON.parse(readFileSync(root+'/initial-identity.json','utf8'));
assert.equal(ids.source,'7b06d7516c4c386f5a23044e74d0c09b95a5a929');for(const rev of [ids.source,ids.tested])assert.equal(execFileSync('git',['rev-parse',rev+'^{tree}'],{cwd:repo,encoding:'utf8'}).trim(),ids.sourceAndTestedTree);
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const zip=readFileSync(root+'/responsiveness-mobile.zip');assert.equal(zip.length,2755515);assert.equal(hash(zip),'2c1c743c49f7081ae18b3d8f9b16e61837d73d777c88ec18f3a567282780a5bd');
const members=execFileSync('unzip',['-Z1',root+'/responsiveness-mobile.zip'],{encoding:'utf8'}).trim().split('\n').filter(x=>!x.endsWith('/'));
const proof=members.map(file=>{const raw=execFileSync('unzip',['-p',root+'/responsiveness-mobile.zip',file],{maxBuffer:20*1024**2});assert.deepEqual(readFileSync(dir+'/'+file),raw);return {file,bytes:raw.length,sha256:hash(raw)};});
const expected='6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44';
const harness=(m:any)=>{for(const [p,h]of Object.entries(m.harnessSha256))assert.equal(hash(execFileSync('git',['show',ids.source+':'+p],{cwd:repo})),h,p);};
const integrity=(x:any,textHash:string,len:number)=>{for(const k of ['sender','peer','saved']){assert.equal(x[k].textSha256,textHash);assert.equal(x[k].textLength,len);}assert.deepEqual(x.sender.pending,{history:0,collaboration:0});assert.deepEqual(x.peer.pending,{history:0,collaboration:0});};
const metrics:any[]=[];const reports:any[]=[];const boundaries:any[]=[];const clocks:any[]=[];let post:any;
for(const file of members.filter(x=>x.endsWith('.json'))){
 const m=json(dir+'/'+file);
 if(file.endsWith('/spn108-metrics.json')){
  assert.equal(m.preset,'mobile');assert.equal(m.attempt,0);assert.equal(m.completed,true);assert.deepEqual(m.errors,[]);assert.equal(m.runner.run,String(ids.ci));assert.equal(m.runner.attempt,'1');
  assert.equal(m.source,m.role==='candidate'?ids.tested:'2c84a18449c7dae09e2817989fac6236be96ef98');harness(m);assert.equal(Object.keys(m.harnessSha256).length,9);
  const capacity=distribution(m.native.flushes.filter((x:any)=>x.reason==='capacity').map((x:any)=>x.durationMs));
  const frame=distribution(m.input.keyToFrameMs),tasks=distribution(m.input.longTasks.map((x:any)=>x.durationMs));
  const idle=m.role==='candidate'?distribution(docIdleDurations(m.native)):null;
  assert.deepEqual(frame,m.summary.frameOpportunityMs);assert.deepEqual(tasks,m.summary.longTaskMs);
  if(m.sample==='profile'){assert.equal(proof.find(x=>x.file===dirname(file)+'/spn108-profile.cpuprofile')?.sha256,m.profileSha256);assert.equal(m.budgetEnforced,false);}
  if(m.role==='candidate'){
   integrity(m.preUndoIntegrity,expected,2088);assert.equal(m.preUndoIntegrity.passed,true);assert.deepEqual(m.preUndoIntegrity.sender.selection,{start:2086,end:2086,segmentId:''});assert.deepEqual(m.preUndoIntegrity.peer.selection,{start:0,end:0,segmentId:''});
   assert.equal(m.undoRedo.outcome,'passed');integrity(m.undoRedo.final,expected,2088);assert.deepEqual(m.finalReloads,[]);
   if(m.sample==='plain-1'){assert.equal(m.undoRedo.requestedGroups,66);integrity(m.undoRedo.undo,hash('\r\n'),2);assert.deepEqual(m.undoRedo.undo.sender.history,{undos:0,redos:66});assert.deepEqual(m.undoRedo.final.sender.history,{undos:66,redos:0});}
   else assert.equal(m.undoRedo.requestedGroups,1);
   assert.equal(m.native.drainWitness.invalidated,false);assert.deepEqual(m.native.drainWitness.invalidations,[]);
   const episode=m.native.drainWitness.idleEpisode;assert.equal(episode.origin,'policy-idle');assert.equal(episode.history,6);assert.equal(episode.collaboration,6);assert.ok(episode.durationMs<=100);
   const native=m.native.drainWitness.nativeFlushes.filter((x:any)=>episode.nativeSequences.includes(x.sequence));assert.equal(native.length,2);assert.ok(native.every((x:any)=>x.outcome==='returned'));assert.deepEqual(native.map((x:any)=>x.phase),['history','collaboration']);
   assert.deepEqual(idle,m.summary.idleFlushPairMs);assert.deepEqual(capacity,m.summary.capacityFlushPairMs);
   if(m.sample!=='profile'){
    assert.equal(m.budgetEnforced,true);assert.equal(m.instrumentation.profiler,false);assert.deepEqual(m.budgets,DOC_RESPONSIVENESS_BUDGETS.mobile);
    assert.equal(m.input.keydownAt.length,2086);assert.equal(capacity.count,65);assert.ok(m.native.flushes.filter((x:any)=>x.reason==='capacity').every((x:any)=>x.history===32&&x.collaboration===32));
    assert.ok(capacity.p95<=50&&capacity.max<=100);assert.ok(idle!.p95<=50&&idle!.max<=100);assert.ok(frame.p95<=200&&tasks.max<=500);
    assert.deepEqual(m.native.pending,{history:0,collaboration:0});assert.deepEqual(m.native.highWater,{history:32,collaboration:32});assert.equal(m.native.drainWitness.completedStates,2086);
    assert.ok(m.native.drainWitness.firstEmpty.observedAt-m.input.keydownAt.at(-1)<=1000);assert.ok(Object.values(m.budgetResults).every(v=>v===true));
   }
  }
  metrics.push({file,role:m.role,sample:m.sample,source:m.source,capacity,idle,frame,tasks,summary:m.summary,requestedGroups:m.undoRedo?.requestedGroups,compositionCpu:m.compositionCpu,profileSha256:m.profileSha256,runner:m.runner,instrumentation:m.instrumentation,budgets:m.budgets,budgetEnforced:m.budgetEnforced,fixture:m.fixture,idleEpisode:m.native.drainWitness?.idleEpisode});
 }else if(file.endsWith('/spn108-post-burst.json')){
  assert.equal(m.source,ids.tested);assert.equal(m.attempt,0);assert.equal(m.completed,true);assert.deepEqual(m.errors,[]);assert.deepEqual(m.reloads,[]);harness(m);assert.equal(m.input.keydownAt.length,2087);
  for(const k of ['continuationRequestReturnMs','continuationKeyToFrameMs','continuationKeyToNativeReadMs','finalOriginalKeyToContinuationFrameMs','finalOriginalKeyToContinuationNativeReadMs'])assert.ok(m.summary[k]<=m.budgets[k],k);
  post={file,summary:m.summary,budgets:m.budgets,fixture:m.fixture,native:m.native,peer:m.peer,saved:m.saved};
 }else if(file.endsWith('/spn108-boundaries.json')){
  assert.equal(m.preset,'mobile');assert.equal(m.physicalIme,false);assert.deepEqual(m.errors,[]);assert.equal(m.compositionEvents.dropped,0);
  if(m.heldWrites!==undefined){assert.equal(m.heldWrites,1);assert.deepEqual(m.forwardedAfterRevocation,[false]);}
  else{assert.equal(m.composingEnter.before.text,m.composingEnter.after.text);assert.deepEqual(m.composingEnter.before.history,m.composingEnter.after.history);assert.deepEqual(m.afterFinalComposition.pending,{history:0,collaboration:0});}
  boundaries.push({file,data:m});
 }else if(file.endsWith('playwright-report/doc-responsiveness.json')){
  const tests:any[]=[];const walk=(s:any)=>{for(const x of s.specs??[])for(const t of x.tests??[])tests.push({title:x.title,timeout:t.timeout,status:t.status,results:t.results.map((v:any)=>({retry:v.retry,status:v.status,duration:v.duration,errors:v.errors}))});for(const c of s.suites??[])walk(c);};walk(m);
  assert.equal(tests.length,file.startsWith('baseline-')?4:7);for(const t of tests){assert.equal(t.results.length,1);assert.equal(t.results[0].retry,0);assert.equal(t.results[0].status,'passed');assert.deepEqual(t.results[0].errors,[]);assert.ok(t.results[0].duration<t.timeout);}reports.push({file,stats:m.stats,tests});
 }else if(file.endsWith('/spn108-profile-clock.json')){
  assert.equal(proof.find(x=>x.file===dirname(file)+'/spn108-profile.cpuprofile')?.sha256,m.sha256);clocks.push({file,...m,uncertaintyMs:m.bracket.afterMs-m.bracket.beforeMs});
 }
}
assert.equal(metrics.length,8);assert.equal(boundaries.length,2);assert.equal(reports.length,2);assert.equal(clocks.length,2);assert.ok(post);
const comparison=json(dir+'/test-results/spn108-comparison-mobile.json');assert.equal(comparison.passed,true);assert.deepEqual(comparison.failures,[]);assert.deepEqual(comparison.unavailable,[]);
writeFileSync(root+'/responsiveness-mobile-proof-b.json',JSON.stringify({ids,proof,metrics,reports,boundaries,post,clocks,comparison},null,2)+'\n');
console.log(JSON.stringify({members:proof.length,metrics:metrics.length,testCount:reports.flatMap(x=>x.tests).length,budgets:metrics.filter(x=>x.role==='candidate'&&x.sample!=='profile').map(x=>({sample:x.sample,capacity:x.capacity,idle:x.idle,frame:x.frame,tasks:x.tasks,drain:x.summary.firstVerifiedBrowserLocalDrainMs,groups:x.requestedGroups})),clocks:clocks.map(x=>({file:x.file,uncertaintyMs:x.uncertaintyMs})),postSummary:post.summary},null,2));
