import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = '/tmp/spn143-hosted';
const checkout = '/Users/mxbaylee/projects/spinel-spn-143';
const archive = root + '/callback-desktop.zip';
const members = JSON.parse(readFileSync(root + '/callback-desktop-members.json', 'utf8'));
const identities = JSON.parse(readFileSync(root + '/identities.json', 'utf8'));
const hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', identities.source + '^{tree}'), identities.tree);
assert.equal(git('rev-parse', identities.tested + '^{tree}'), identities.tree);
const archiveHash = createHash('sha256'); let archiveBytes = 0;
for await (const chunk of createReadStream(archive)) { archiveHash.update(chunk); archiveBytes += chunk.length; }
const archiveSha = archiveHash.digest('hex');
assert.equal(archiveSha, '824b949ebaf5ad6a4fbbb06194670ec585133e1035a0076fddbd08be933784ec');
assert.equal(archiveBytes, 123988279);
const expected = new Map<string, { bytes: number; sha256: string; raw?: {bytes: number; sha256: string} }>();
const summaries: unknown[] = [];
for (const member of members.filter((m: {file: string}) => m.file.endsWith('/spn113-evidence.json'))) {
  const m = JSON.parse(readFileSync(root + '/callback-desktop/' + member.file, 'utf8'));
  const p = JSON.parse(readFileSync(root + '/callback-desktop/' + dirname(member.file) + '/spn134-progress.json', 'utf8'));
  assert.equal(m.attempt, 0); assert.equal(m.preset, 'desktop');
  assert.equal(m.runner.run, String(identities.ci)); assert.equal(m.runner.attempt, '1');
  assert.equal(m.source, m.role === 'candidate' ? identities.tested : '0e1df4725d9eccb77574d25e3eecdf678fe6ff44');
  assert.equal(m.complete, true); assert.equal(m.passed, true); assert.equal(m.behaviorPassed, true);
  assert.deepEqual(m.cleanup, {sessionDetached: true, fixtureClosed: true}); assert.deepEqual(m.errors, []);
  assert.equal(p.terminal, 'passed'); assert.equal(p.firstFailure, null); assert.equal(p.persistenceFailure, null); assert.equal(p.droppedEvents, 0);
  for (const phase of ['trace-end-request','trace-completion','trace-stream-open','trace-stream-close','trace-parse','trace-attribution','trace-analysis','cdp-detach','fixture-cleanup-complete']) assert.ok(p.events.some((e: {phase:string}) => e.phase === phase), phase);
  for (const [path, hash] of Object.entries(m.harnessSha256)) assert.equal(hex(execFileSync('git', ['show', identities.source + ':' + path], {cwd:checkout})), hash, path);
  assert.equal(m.trace.completion.dataLossOccurred, false); assert.equal(m.trace.completion.traceFormat, 'json'); assert.equal(m.trace.completion.streamCompression, 'none');
  assert.deepEqual(m.trace.storage, {compression:'gzip', producer:'node:zlib', level:1});
  assert.equal(m.traceRead.uncompressedBytes, m.trace.transport.bytes); assert.equal(m.traceRead.uncompressedSha256, m.trace.transport.sha256);
  const text = Array.from({length:16}, (_,i) => `Line ${i+1}: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.`).join('\r') + '\r\n';
  assert.equal(m.nativeAfterTyping.text, text); assert.equal(m.textSha256, hex(text));
  assert.deepEqual(m.nativeAfterTyping.selection, {start:2086,end:2086,segmentId:''}); assert.deepEqual(m.nativeAfterTyping.pending,{history:0,collaboration:0});
  assert.equal(m.observedKeydowns,2086); assert.equal(m.input.keydownAt.length,2086); assert.equal(m.input.keyToFrameMs.length,2086);
  for (const f of [m.trace, ...m.attribution.artifacts]) expected.set(dirname(member.file) + '/' + f.file, {...f, ...(f === m.trace ? {raw:m.trace.transport} : {})});
  const familySummary = Object.fromEntries(Object.entries(m.analysis.families).map(([k,v]: [string, any]) => [k, {pendingHighWater:v.pendingHighWater,pendingAt:v.pendingAt,pendingAtTraceEnd:v.pendingAtTraceEnd,callbacksAfterDisposal:v.callbacksAfterDisposal,installationsAfterDisposal:v.installationsAfterDisposal,installations:v.installations,unmatchedRemovals:v.unmatchedRemovals}]));
  summaries.push({role:m.role, source:m.source, dirtyPaths:m.dirtyPaths, browser:m.browser,runtime:m.runtime,playwright:m.playwright, fixture:m.fixture,instrumentation:m.instrumentation, trace:m.trace,traceRead:m.traceRead,analysisKeys:Object.keys(m.analysis),analysisComplete:m.analysis.complete,analysisAccepted:m.analysis.accepted,analysisBounded:m.analysis.bounded,families:familySummary,attribution:{unmapped:m.attribution.unmapped.length,artifacts:m.attribution.artifacts.length},phaseEvents:p.events.filter((e:{kind:string})=>e.kind==='phase'),terminal:p.terminal,dropped:p.droppedEvents,behaviorKeys:Object.keys(m).filter(k=>!['analysis','input','attribution','traceBufferUsage'].includes(k)),blink:{count:m.blink?.length,allVisible:m.blink?.every((v:any)=>v.visible),strokes:[...new Set(m.blink?.map((v:any)=>v.stroke))]},zoom:m.zoom,heapLimitations:m.heapLimitations,bufferUsageCount:m.traceBufferUsage?.length});
}
const proofs: unknown[]=[];
for (const member of members) {
  if (/\.sqlite(?:-|$)/.test(member.file)) continue;
  const exp = expected.get(member.file);
  const child = spawn('unzip',['-p',archive,member.file],{stdio:['ignore','pipe','pipe']});
  let stderr=''; child.stderr.on('data', c=>{stderr=(stderr+c).slice(-4000);});
  const exited = once(child,'exit');
  const storedHash=createHash('sha256'); let bytes=0;
  const stored = new Transform({transform(c, _e, cb){storedHash.update(c); bytes+=c.length; cb(null,c);}});
  const rawHash=createHash('sha256'); let rawBytes=0;
  const sink=new Writable({write(c,_e,cb){if(exp?.raw){rawHash.update(c);rawBytes+=c.length;}cb();}});
  try {
    if(exp?.raw) await pipeline(child.stdout,stored,createGunzip(),sink);
    else await pipeline(child.stdout,stored,sink);
  } catch(error){child.kill('SIGKILL');await exited;throw error;}
  const [code] = await exited; assert.equal(code,0,stderr);
  const sha256=storedHash.digest('hex'); assert.equal(bytes,member.bytes,member.file);
  if(exp){assert.equal(bytes,exp.bytes,member.file);assert.equal(sha256,exp.sha256,member.file);expected.delete(member.file);}
  const raw=exp?.raw ? {bytes:rawBytes,sha256:rawHash.digest('hex')}:undefined;
  if(raw)assert.deepEqual(raw,exp!.raw,member.file);
  proofs.push({file:member.file,bytes,sha256,...(raw?{raw}:{})});
}
assert.equal(expected.size,0);
const reports = members.filter((m:{file:string})=>m.file.endsWith('playwright-report/doc-callback-lifetimes.json')).map((m:{file:string})=>{
 const r=JSON.parse(readFileSync(root+'/callback-desktop/'+m.file,'utf8'));
 const tests:any[]=[]; const walk=(s:any)=>{for(const spec of s.specs??[])for(const t of spec.tests??[])tests.push({title:spec.title,timeout:t.timeout,expectedStatus:t.expectedStatus,status:t.status,results:t.results.map((v:any)=>({retry:v.retry,status:v.status,duration:v.duration,errors:v.errors}))});for(const child of s.suites??[])walk(child);};walk(r);
 assert.equal(tests.length,1);assert.equal(tests[0].timeout,420000);assert.equal(tests[0].results.length,1);assert.equal(tests[0].results[0].retry,0);assert.equal(tests[0].results[0].status,'passed');assert.ok(tests[0].results[0].duration<420000);
 return {file:m.file,stats:r.stats,tests};
});
const result={identities,archive:{bytes:archiveBytes,sha256:archiveSha},reports,summaries,proofs};
writeFileSync(root+'/callback-desktop-audit-a.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({archive:result.archive,membersVerified:proofs.length,manifests:summaries.length,reports},null,2));
