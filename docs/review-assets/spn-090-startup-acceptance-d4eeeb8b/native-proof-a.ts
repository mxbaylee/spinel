import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root='/tmp/spn090-startup-hosted';
const source='d4eeeb8b4871695a0efc9b2c09259cc801784894';
const tested='1ac497cddf189165a95d2de5e5875e114fe452e3';
const sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const load=(p:string)=>JSON.parse(readFileSync(join(root,p),'utf8'));
const proof:any={complete:false,source,tested,run:42072843841,attempt:1,archives:[],inputs:{},sourceFiles:{}};
try {
 for(const p of ['native-run.json','native-jobs.json','native-artifacts.json'])proof.inputs[p]=sha(readFileSync(join(root,p)));
 const run=load('native-run.json'),jobs=load('native-jobs.json').jobs,artifacts=load('native-artifacts.json').artifacts;
 assert.equal(run.id,proof.run);assert.equal(run.head_sha,source);assert.equal(run.run_attempt,1);assert.equal(run.conclusion,'success');assert.equal(run.status,'completed');assert.equal(jobs.length,3);
 const owners=[['chrome',13436103315,127405086693,37,13],['firefox',13437353307,127405087559,37,15],['safari',13435814891,127405087338,39,18]] as const;
 for(const [browser,id,jobId,count,memberCount] of owners){
  const artifact=artifacts.find((a:any)=>a.id===id);assert.ok(artifact);assert.equal(artifact.workflow_run.head_sha,source);assert.equal(artifact.workflow_run.id,proof.run);
  const job=jobs.find((j:any)=>j.id===jobId);assert.ok(job);assert.equal(job.head_sha,source);assert.equal(job.run_attempt,1);assert.equal(job.conclusion,'success');assert.equal(job.status,'completed');assert.ok(job.steps.every((s:any)=>['success','skipped'].includes(s.conclusion)));
  const file=join(root,`native-${id}.zip`),bytes=readFileSync(file);assert.equal(bytes.length,artifact.size_in_bytes);assert.equal('sha256:'+sha(bytes),artifact.digest);
  execFileSync('unzip',['-tqq',file],{encoding:'utf8'});
  const names=execFileSync('unzip',['-Z1',file],{encoding:'utf8'}).trim().split('\n');assert.equal(names.length,memberCount);assert.equal(new Set(names).size,names.length);
  const record:any={browser,artifact:id,job:jobId,sha256:sha(bytes),bytes:bytes.length,members:[],stageCount:0};proof.archives.push(record);
  const members=new Map<string,Buffer>();
  for(const name of names){assert.ok(!name.startsWith('/')&&!name.split('/').includes('..')&&!name.endsWith('/'));const data=execFileSync('unzip',['-p',file,name],{maxBuffer:2*1024*1024});members.set(name,data);record.members.push({name,bytes:data.length,sha256:sha(data)});}
  const r=JSON.parse(members.get(browser+'/acceptance.json')!.toString());assert.equal(r.sourceSha,source);assert.equal(r.testedSha,tested);assert.equal(r.attempt,'1');assert.equal(r.run,'https://github.com/mxbaylee/spinel/actions/runs/'+proof.run);assert.equal(r.status,'passed');assert.equal(r.browser,browser);assert.equal(r.stages.length,count);assert.ok(!r.error&&!r.teardownError&&!r.fixtureTeardownError);
  const stages=(n:string)=>r.stages.filter((s:any)=>s.name===n);record.stageCount=count;record.stageNames=r.stages.map((s:any)=>s.name);
  assert.equal(r.launches.length,3);assert.equal(stages('browser-start').length,3);assert.equal(stages('browser-stop').length,3);assert.equal(new Set(r.launches.map((l:any)=>l.browserPid)).size,3);
  for(let i=0;i<3;i++){const l=r.launches[i],stop=stages('browser-stop')[i];assert.deepEqual(l.profile,r.launches[0].profile);assert.equal(l.previousBrowserPid,i?r.launches[i-1].browserPid:null);assert.equal(stop.browserPid,l.browserPid);assert.equal(stop.browserExited,true);assert.equal(stop.driverExited,true);}
  const pending=stages('pending-restart-retained');assert.equal(pending.length,4);assert.deepEqual(pending.map((s:any)=>s.kind+'-'+s.outcome).sort(),['doc-conflict','doc-normal','sheet-conflict','sheet-normal']);
  for(const p of pending){assert.match(p.checkpointSha256,/^[a-f0-9]{64}$/);assert.equal(p.imageHashes.length,3);assert.ok(p.imageHashes.every((h:any)=>h.size>0&&/^[a-f0-9]{64}$/.test(h.sha256)));assert.ok(members.has(browser+'/'+p.visual.file));assert.ok(p.visual.colorPixelCounts.every((v:number)=>v>0));assert.equal(p.visual.captures,1);}
  const texts=stages('native-clipboard-content');assert.equal(texts.length,6);for(const t of texts)assert.equal(t.text,t.kind==='sheet'?'731':'Desktop offline 731 Recovery base notes');
  const normal=stages('normal-reconnect-exact-content-once'),conflict=stages('conflict-copy-preserves-original');assert.equal(normal.length,2);assert.equal(conflict.length,2);
  for(const s of [...normal,...conflict]){assert.match(s.snapshotSha256,/^[a-f0-9]{64}$/);assert.equal(s.images.length,3);for(const i of s.images){assert.equal(i.mime,'image/png');assert.equal(sha(Buffer.from(i.bytes,'hex')),i.id);}if(s.copyId){assert.notEqual(s.copyId,s.itemId);assert.equal(s.receipts.filter((v:any)=>v.item_id===s.copyId).length,1);assert.ok(s.receipts.every((v:any)=>v.possible_replay_crash===0));}else assert.equal(s.revision,2);}
  const deletion=stages('storage-deletion');assert.equal(deletion.length,1);assert.equal(deletion[0].deletion.status,'passed');assert.ok(deletion[0].deletion.operations.every((o:any)=>o.status==='passed'));
  assert.deepEqual(stages('cleared-storage-is-not-advertised')[0].lost,{account:null,available:0});assert.ok(stages('missing-data-cannot-open-offline')[0].message.includes("You're offline"));assert.equal(stages('complete').length,1);assert.equal(r.stages.at(-1).name,'browser-stop');
  for(const n of ['transport-disabled-before-quit','transport-disabled-before-relaunch','transport-still-disabled-before-pending-relaunch','post-deletion-outage']){assert.equal(stages(n).length,1);assert.equal(stages(n)[0].offline,true);assert.equal(stages(n)[0].activeBrowserSockets,0);}
  assert.equal(r.transport.activeBrowserSockets,0);assert.equal(r.transport.logins,1);
  const v=JSON.parse(members.get(browser+'/versions.json')!.toString());assert.equal(v.sourceSha,source);assert.equal(v.status,'passed');assert.equal(v.installed,r.launches[0].version);
  record.version=v.installed;record.runner=r.runner;record.launches=r.launches;record.persistence=r.persistence.map((p:any)=>({before:p.before,after:p.after,permission:p.permission?.action??null}));record.deletion=deletion[0].deletion;record.transport=r.transport;
  if(browser==='safari'){const q=JSON.parse(members.get('safari-profile-probe.json')!.toString());assert.equal(q.status,'passed');assert.equal(q.sourceSha,source);assert.equal(q.testedSha,tested);assert.notEqual(q.beforePid,q.afterPid);assert.equal(q.retained.localStorage,q.retained.indexedDB);assert.equal(q.retained.localStorage,q.retained.cache);assert.equal(q.retained.worker,true);assert.equal(q.prepared.persistenceRequested,false);for(const s of ['online','offline'])assert.equal(q.paintBaselines[s].canvas2d.drawCompleted,true);record.capability={status:q.status,scope:q.scope,beforePid:q.beforePid,afterPid:q.afterPid,retained:q.retained,prepared:q.prepared};}
 }
 for(const file of ['scripts/ci/desktop-offline.ts','scripts/ci/desktop-storage.ts','scripts/ci/desktop-browser.ts','.github/workflows/desktop-offline.yml']){try{proof.sourceFiles[file]=sha(readFileSync(file));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 proof.sourceTree=execFileSync('git',['rev-parse',source+'^{tree}'],{encoding:'utf8'}).trim();proof.complete=true;
}catch(e){proof.error=String(e);throw e;}finally{writeFileSync(join(root,'native-proof-a.json'),JSON.stringify(proof,null,2)+'\n');}
console.log(JSON.stringify({complete:proof.complete,owners:proof.archives.map((a:any)=>({browser:a.browser,stages:a.stageCount,members:a.members.length})),sourceTree:proof.sourceTree}));
