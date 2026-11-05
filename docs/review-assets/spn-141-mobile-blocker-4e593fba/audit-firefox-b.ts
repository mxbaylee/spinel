import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root='/tmp/spn141-after144-hosted', cwd='/Users/mxbaylee/projects/spinel-spn-141';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const ids=JSON.parse(readFileSync(`${root}/initial-identity.json`,'utf8'));
const source='4e593fbaf9ea89585920053b9415f9a8eac0944f';
assert.equal(ids.source,source);
const git=(...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
assert.equal(git('rev-parse',`${source}^{tree}`),ids.sourceAndTestedTree);
assert.equal(git('rev-parse',`${ids.tested}^{tree}`),ids.sourceAndTestedTree);
const zip=readFileSync(`${root}/firefox.zip`);
assert.equal(zip.length,453796);assert.equal(hash(zip),'6c7798700d51177bf574849b8725ba0776d5b51532a9ac350d66697f536ed5ed');
const names=execFileSync('unzip',['-Z1',`${root}/firefox.zip`],{encoding:'utf8'}).trim().split('\n').filter(n=>!n.endsWith('/'));
assert.equal(new Set(names).size,names.length);
const members=names.map(name=>{assert.ok(!name.includes('..')&&!name.startsWith('/')); const original=execFileSync('unzip',['-p',`${root}/firefox.zip`,name],{maxBuffer:2000000});const extracted=readFileSync(`${root}/firefox/${name}`);assert.deepEqual(extracted,original);return {name,bytes:original.length,sha256:hash(original)};});
const r=JSON.parse(readFileSync(`${root}/firefox/firefox/acceptance.json`,'utf8'));
assert.equal(r.sourceSha,source);assert.equal(r.testedSha,ids.tested);assert.equal(r.attempt,'1');assert.ok(r.run.endsWith('/41970163073'));assert.equal(r.status,'passed');
for(const key of ['error','teardownError','fixtureTeardownError'])assert.equal(r[key],undefined);
const s=r.stages, all=(n:string)=>s.filter((x:any)=>x.name===n), one=(n:string)=>{const a=all(n);assert.equal(a.length,1,n);return a[0];};
for(const n of ['all-four-downloads-complete','exact-records-captured-before-quit','offline-catalog-and-original-records-retained','native-offline-edits-committed','complete'])one(n);
assert.equal(r.persistence.length,4);assert.ok(r.persistence.every((p:any)=>p.after===true));assert.equal(r.persistence.filter((p:any)=>p.permission).length,1);assert.equal(r.persistence[0].permission.action,'allow');assert.match(r.persistence[0].permission.observedText,/localhost:8176/);
assert.equal(r.launches.length,4);assert.equal(new Set(r.launches.map((x:any)=>x.browserPid)).size,4);
const exits=s.filter((x:any)=>x.name.startsWith('browser-stop'));assert.equal(exits.length,4);
for(let i=0;i<4;i++){const l=r.launches[i];assert.equal(l.version,'159.0.1');assert.deepEqual(l.profile,r.launches[0].profile);assert.equal(l.profile.requestedPath,l.profile.actualPath);assert.equal(l.previousBrowserPid,i?r.launches[i-1].browserPid:null);const e=exits.find((e:any)=>e.browserPid===l.browserPid);assert.ok(e);assert.equal(e.driverPid,l.driverPid);assert.equal(e.browserExited,true);assert.equal(e.driverExited,true);assert.ok(Date.parse(e.stoppedAt)>Date.parse(l.startedAt));if(i<3)assert.ok(Date.parse(e.stoppedAt)<Date.parse(r.launches[i+1].startedAt));}
for(const [i,st] of all('browser-start').entries()){assert.equal(st.secureContext,true);assert.equal(st.storagePersisted,i>0);}
const pending=all('pending-restart-retained');assert.equal(pending.length,4);assert.deepEqual(pending.map((p:any)=>`${p.kind}/${p.outcome}`).sort(),['doc/conflict','doc/normal','sheet/conflict','sheet/normal']);
const normals=all('normal-reconnect-exact-content-once'), conflicts=all('conflict-copy-preserves-original');assert.equal(normals.length,2);assert.equal(conflicts.length,2);
const imageProof=[];
for(const p of pending){assert.match(p.checkpointSha256,/^[a-f0-9]{64}$/);assert.equal(p.visual.captures,1);assert.ok(p.visual.colorPixelCounts.every((v:number)=>v>100));assert.equal(p.imageHashes.length,3);const after=[...normals,...conflicts].find((v:any)=>v.itemId===p.itemId);assert.ok(after);assert.match(after.snapshotSha256,/^[a-f0-9]{64}$/);if(p.outcome==='normal')assert.equal(after.revision,2);else assert.notEqual(after.copyId,p.itemId);assert.equal(after.images.length,3);for(const im of after.images){const bytes=Buffer.from(im.bytes,'hex');assert.equal(hash(bytes),im.id);const old=p.imageHashes.find((v:any)=>v.sha256===im.id);assert.ok(old);assert.equal(bytes.length,old.size);assert.equal(old.source,`/api/items/${p.itemId}/images/${im.id}`);imageProof.push({item:p.itemId,image:im.id,size:bytes.length});}}
assert.equal(conflicts[0].receipts.length,1);assert.equal(conflicts[1].receipts.length,2);assert.deepEqual(conflicts[1].receipts[0],conflicts[0].receipts[0]);for(const c of conflicts){assert.ok(c.receipts.some((v:any)=>v.item_id===c.copyId));for(const v of c.receipts){assert.equal(v.user_id,r.actor.id);assert.equal(v.possible_replay_crash,0);}}assert.equal(new Set(conflicts[1].receipts.map((v:any)=>v.recovery_id)).size,2);
const clips=all('native-clipboard-content');assert.equal(clips.length,6);assert.equal(clips.filter((c:any)=>c.kind==='sheet'&&c.text==='731').length,3);assert.equal(clips.filter((c:any)=>c.kind==='doc'&&c.text==='Desktop offline 731 Recovery base notes').length,3);
const prep=one('storage-loss-tabs-prepared'), hand=one('storage-loss-tabs-handed-off'), restarted=one('storage-loss-tabs-restarted');
const inert='https://localhost:8176/_desktop-storage-loss', fresh=inert+'?phase=uncontrolled';
assert.deepEqual(prep.after,[inert]);assert.deepEqual(hand.before,[inert]);assert.deepEqual(hand.after,[fresh]);assert.deepEqual(hand.documents,[{controller:null,fresh:true,marker:'inert',ready:'complete',scripts:0,url:fresh}]);assert.deepEqual(restarted.before,[fresh]);assert.deepEqual(restarted.after,[fresh]);
const unreg=one('storage-loss-unregistration').preparation, q=one('storage-loss-quiescence-before-stop').quiescence, d=one('storage-deletion').deletion;
for(const record of [unreg,q,d]){assert.equal(record.status,'passed');assert.equal(record.timeoutMs,28000);assert.ok(record.operations.every((x:any)=>x.status==='passed'));}
const unregister=unreg.operations.filter((o:any)=>o.name.startsWith('serviceWorker.unregister'));assert.equal(unregister.length,1);assert.equal(unregister[0].value,true);
assert.equal(unreg.operations.at(-1).value.controller,'https://localhost:8176/service-worker.js');
assert.deepEqual(q.operations.map((x:any)=>x.name),['verify-preparation-document','serviceWorker.getRegistrations','verify-uncontrolled']);assert.deepEqual(q.operations.at(-1).value,{controller:null,workers:[]});
assert.equal(d.phase,'delete');assert.equal(d.database,`spinel-offline-${r.actor.id}`);assert.deepEqual(d.operations.find((x:any)=>x.name==='verify-uncontrolled').value,{controller:null,workers:[]});assert.equal(d.operations.filter((x:any)=>x.name.startsWith('caches.delete:')).length,1);assert.equal(d.operations.find((x:any)=>x.name.startsWith('caches.delete:')).value,true);assert.equal(d.operations.filter((x:any)=>x.name.startsWith('indexedDB.deleteDatabase:')).length,1);assert.ok(!d.operations.some((x:any)=>x.name.includes('unregister')));
const empty=d.operations.at(-1).value;assert.deepEqual(empty,{cacheNames:[],databases:['UniverLocalStorage','spinel-offline-runtime'],localStorageEntries:0,workers:[]});
const order=['storage-loss-tabs-prepared','storage-loss-unregistration','storage-loss-tabs-handed-off','storage-loss-quiescence-before-stop','browser-stop-before-storage-loss','storage-loss-tabs-restarted','storage-deletion','cleared-storage-is-not-advertised','post-deletion-outage','missing-data-cannot-open-offline','complete'];for(let i=1;i<order.length;i++)assert.ok(s.indexOf(one(order[i-1]))<s.indexOf(one(order[i])));
assert.deepEqual(one('cleared-storage-is-not-advertised').lost,{account:null,available:0});assert.match(one('missing-data-cannot-open-offline').message,/You're offline[\s\S]*Connect to the internet/);assert.ok(!one('missing-data-cannot-open-offline').message.includes('Saved on this device'));assert.equal(r.transport.activeBrowserSockets,0);assert.equal(r.transport.logins,1);assert.equal(r.transport.offline,true);
const job=JSON.parse(readFileSync(root+'/firefox-job.json','utf8'));assert.equal(job.id,127056281582);assert.equal(job.run_id,ids.native);assert.equal(job.head_sha,source);assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');assert.equal(job.run_attempt,1);assert.ok(job.steps.every((x:any)=>x.conclusion===(x.name==='Prove same-profile ordinary Safari restart'?'skipped':'success')));

writeFileSync(`${root}/firefox-proof-b.json`,JSON.stringify({source,tested:ids.tested,tree:ids.sourceAndTestedTree,run:41970163073,job:job.id,attempt:1,zip:{bytes:zip.length,sha256:hash(zip)},members,stageCount:s.length,version:r.release.installed,launches:r.launches.map((l:any)=>({pid:l.browserPid,previous:l.previousBrowserPid,driver:l.driverPid,startedAt:l.startedAt})),profile:r.launches[0].profile,imageProof,unregistration:unreg,handoff:hand,quiescence:q,deletion:d,exits,postLoss:one('missing-data-cannot-open-offline').message,limits:'Full snapshot equality is enforced by inspected exact executed source; raw full snapshots are not retained for independent replay. No browser rerun or older acceptance used.',result:'passed'},null,2)+'\n');
console.log(`PASS: exact Firefox first-attempt source, ${members.length} ZIP/member hashes, ${s.length} stages, four same-profile launches/exits, complete content/image receipts and strict storage handoff/deletion.`);
