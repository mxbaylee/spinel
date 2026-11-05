import assert from 'node:assert/strict';
import {createReadStream,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {compareDocCallbackEvidence} from '/Users/mxbaylee/projects/spinel-spn-143/scripts/ci/doc-callback-comparison.ts';
const root='/tmp/spn143-hosted', dir=root+'/callback-mobile-retained';
const checkout='/Users/mxbaylee/projects/spinel-spn-143';
const start=Date.now();
const limit=setTimeout(()=>{throw new Error('120-second independent audit bound exceeded');},120000);
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const digest=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
async function hashFile(path:string,raw=false){
 const source=createReadStream(path,{highWaterMark:65536});
 const stream=raw?source.pipe(createGunzip({chunkSize:65536})):source;
 source.on('error',e=>stream.destroy(e));
 let bytes=0; const h=createHash('sha256');
 try{for await(const c of stream){bytes+=c.length;assert.ok(bytes<2*1024**3);h.update(c);}}
 finally{stream.destroy();source.destroy();}
 return {bytes,sha256:h.digest('hex')};
}
const ids=json(root+'/identities.json');
const git=(...a:string[])=>execFileSync('git',a,{cwd:checkout,encoding:'utf8'}).trim();
assert.equal(ids.source,'96b11bf0374540d28e5537d4a9cddb1280403e21');
for(const s of [ids.source,ids.tested])assert.equal(git('rev-parse',s+'^{tree}'),ids.tree);
const zip=await hashFile(root+'/callback-mobile.zip');
assert.deepEqual(zip,{bytes:115553097,sha256:'e8ceed3554ecbb4c58e2317ffadeacb12b84229235b86ca51d568be6f2ec2852'});
const pkg=json(root+'/callback-mobile-package.json');
assert.equal(pkg.count,77);assert.equal(Object.keys(pkg.members).length,77);assert.equal(pkg.omitted.length,12);
assert.ok(pkg.omitted.every((x:string)=>/\.sqlite(?:-(?:wal|shm))?$/.test(x)));
const proofs:any[]=[];
for(const [file,exp] of Object.entries(pkg.members)){
 const got=await hashFile(join(dir,file));assert.deepEqual(got,exp,file);proofs.push({file,...got});
}
const manifests:any[]=[];const summaries:any[]=[];let artifacts=0;
for(const file of Object.keys(pkg.members).filter(x=>x.endsWith('/spn113-evidence.json'))){
 const m=json(join(dir,file)); const parent=dirname(join(dir,file)); const p=json(join(parent,'spn134-progress.json'));
 manifests.push(m);
 assert.equal(m.source,m.role==='candidate'?ids.tested:'0e1df4725d9eccb77574d25e3eecdf678fe6ff44');
 assert.equal(m.runner.run,String(ids.ci));assert.equal(m.runner.attempt,'1');assert.equal(m.attempt,0);assert.equal(m.preset,'mobile');
 for(const k of ['passed','complete','behaviorPassed'])assert.equal(m[k],true);
 assert.deepEqual(m.cleanup,{sessionDetached:true,fixtureClosed:true});assert.deepEqual(m.errors,[]);
 assert.equal(p.terminal,'passed');assert.equal(p.firstFailure,null);assert.equal(p.persistenceFailure,null);assert.equal(p.droppedEvents,0);
 const events=p.events.filter((e:any)=>e.kind==='phase');
 const at=(phase:string)=>{const e=events.find((e:any)=>e.phase===phase);assert.ok(e,phase);return e.atMs;};
 assert.ok(at('fixture-cleanup-complete')<420000);assert.ok(p.events.at(-1).atMs<420000);
 const timing={behaviorCompleteMs:at('behavior-complete'),completionWaitMs:at('trace-stream-open')-at('trace-completion'),streamStoreMs:at('trace-stream-close')-at('trace-stream-read'),parseMs:at('trace-attribution')-at('trace-parse'),attributionMs:at('trace-analysis')-at('trace-attribution'),cleanupCompleteMs:at('fixture-cleanup-complete'),terminalMs:p.events.at(-1).atMs};
 for(const [path,h] of Object.entries(m.harnessSha256))assert.equal(digest(execFileSync('git',['show',ids.source+':'+path],{cwd:checkout})),h,path);
 assert.equal(Object.keys(m.harnessSha256).length,12);
 const text=Array.from({length:16},(_,i)=>`Line ${i+1}: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.`).join('\r')+'\r\n';
 assert.equal(m.nativeAfterTyping.text,text);assert.equal(m.textSha256,digest(text));
 assert.deepEqual(m.nativeAfterTyping.selection,{start:2086,end:2086,segmentId:''});assert.deepEqual(m.nativeAfterTyping.pending,{history:0,collaboration:0});
 assert.equal(m.observedKeydowns,2086);assert.equal(m.input.keydownAt.length,2086);assert.equal(m.input.keyToFrameMs.length,2086);
 assert.ok(m.blink.length>2);assert.ok(m.blink.every((x:any)=>x.visible));assert.equal(new Set(m.blink.map((x:any)=>x.stroke)).size,2);
 assert.deepEqual(m.zoom.before.scale,m.zoom.restored.scale);assert.equal(m.zoom.restored.start,2086);assert.equal(m.zoom.restored.end,2086);
 assert.equal(m.instrumentation.cpuThrottle,4);assert.deepEqual(m.instrumentation.viewport,{width:390,height:844});assert.equal(m.instrumentation.touch,true);assert.equal(m.environment.coarsePointer,true);
 assert.equal(m.trace.completion.streamCompression,'none');assert.equal(m.trace.completion.traceFormat,'json');assert.equal(m.trace.completion.dataLossOccurred,false);
 assert.deepEqual(m.trace.storage,{compression:'gzip',producer:'node:zlib',level:1});
 for(const f of [m.trace,...m.attribution.artifacts]){
  const name=join(dirname(file),f.file);assert.deepEqual(pkg.members[name],{bytes:f.bytes,sha256:f.sha256},name);artifacts++;
 }
 const raw=await hashFile(join(parent,m.trace.file),true);assert.deepEqual(raw,m.trace.transport);assert.equal(raw.bytes,m.traceRead.uncompressedBytes);assert.equal(raw.sha256,m.traceRead.uncompressedSha256);
 assert.equal(m.traceRead.sourceEvents,m.traceRead.retainedEvents);assert.deepEqual(m.analysis.evidenceFailures,[]);
 if(m.role==='candidate'){assert.equal(m.analysis.bounded,true);assert.deepEqual(m.analysis.candidateViolations,[]);}
 const families=Object.fromEntries(Object.entries(m.analysis.families).map(([k,v]:[string,any])=>[k,{pendingHighWater:v.pendingHighWater,pendingAt:v.pendingAt,pendingAtTraceEnd:v.pendingAtTraceEnd,callbacksAfterDisposal:v.callbacksAfterDisposal,installationsAfterDisposal:v.installationsAfterDisposal}]));
 summaries.push({role:m.role,source:m.source,browser:m.browser,runtime:m.runtime,playwright:m.playwright,dirtyPaths:m.dirtyPaths,timing,trace:m.trace,traceRead:m.traceRead,families,attributionArtifacts:m.attribution.artifacts.length,unmapped:m.attribution.unmapped.length,cleanup:m.cleanup,terminal:p.terminal,blinkSamples:m.blink.length,zoom:m.zoom,heapLimitations:m.heapLimitations});
}
assert.equal(manifests.length,2);
const baseline=manifests.find(m=>m.role==='baselineObservation'),candidate=manifests.find(m=>m.role==='candidate');
const comparison=json(dir+'/test-results/spn113-comparison-mobile.json');
const recomputed=compareDocCallbackEvidence('mobile',{manifest:baseline,analysis:baseline.analysis,failures:[]},{manifest:candidate,analysis:candidate.analysis,failures:[]},ids.tested);
assert.deepEqual(recomputed,comparison);assert.equal(comparison.accepted,true);assert.deepEqual(comparison.failures,[]);
const reports=[];
for(const file of Object.keys(pkg.members).filter(x=>x.endsWith('/doc-callback-lifetimes.json'))){
 const r=json(join(dir,file));const tests:any[]=[];
 const walk=(s:any)=>{for(const x of s.specs??[])for(const t of x.tests??[])tests.push({title:x.title,timeout:t.timeout,status:t.status,results:t.results.map((v:any)=>({retry:v.retry,status:v.status,duration:v.duration,errors:v.errors}))});for(const c of s.suites??[])walk(c);};walk(r);
 assert.equal(tests.length,1);const t=tests[0];assert.equal(t.timeout,420000);assert.equal(t.results.length,1);assert.equal(t.results[0].retry,0);assert.equal(t.results[0].status,'passed');assert.deepEqual(t.results[0].errors,[]);assert.ok(t.results[0].duration<420000);reports.push({file,stats:r.stats,tests});
}
assert.equal(reports.length,2);
clearTimeout(limit);
const result={identities:ids,zip,verifiedRetainedMembers:proofs.length,omitted:pkg.omitted,manifestArtifactsVerified:artifacts,rawEventReanalysis:false,comparisonAccepted:true,comparisonMatchesRetainedAnalysis:true,reports,summaries,proofs,elapsedMs:Date.now()-start};
writeFileSync(root+'/callback-mobile-proof-b.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({verified:proofs.length,artifacts,comparisonAccepted:true,reports,summaries:summaries.map(x=>({role:x.role,timing:x.timing,raw:x.trace.transport,stored:{bytes:x.trace.bytes,sha256:x.trace.sha256},families:x.families})),elapsedMs:result.elapsedMs},null,2));
