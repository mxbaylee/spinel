import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='/tmp/spn141-after144-hosted';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const zip=readFileSync(root+'/chrome.zip');
assert.equal(zip.length,229104);assert.equal(hash(zip),'c86ad2984f304f7132e01600649c716bccf50a35ffc4362068cb3bbaf62b39b5');
execFileSync('unzip',['-t',root+'/chrome.zip']);
execFileSync('unzip',['-q',root+'/chrome.zip','-d',root+'/chrome']);
const artifact=JSON.parse(readFileSync(root+'/chrome-artifact.json','utf8')); assert.equal(artifact.id,13389835263); assert.equal(artifact.digest,'sha256:'+hash(zip)); assert.equal(artifact.workflow_run.id,41970163073);
const job=JSON.parse(readFileSync(root+'/chrome-job.json','utf8')); assert.equal(job.id,127056281012); assert.equal(job.run_id,41970163073); assert.equal(job.run_attempt,1); assert.equal(job.status,'completed'); assert.equal(job.conclusion,'success'); assert.ok(job.steps.every((s:any)=>s.conclusion==='success'||s.conclusion==='skipped'));

const names=execFileSync('unzip',['-Z1',root+'/chrome.zip'],{encoding:'utf8'}).trim().split('\n').filter(n=>!n.endsWith('/'));
const members=names.map(name=>{const raw=execFileSync('unzip',['-p',root+'/chrome.zip',name]);assert.deepEqual(raw,readFileSync(root+'/chrome/'+name));return{name,bytes:raw.length,sha256:hash(raw)};});
const report=JSON.parse(readFileSync(root+'/chrome/chrome/acceptance.json','utf8'));
assert.equal(report.sourceSha,'4e593fbaf9ea89585920053b9415f9a8eac0944f');assert.equal(report.testedSha,'f0e74d52629923737985ce03e4f32ff218dcf76d');assert.equal(report.attempt,'1');assert.equal(report.run,'https://github.com/mxbaylee/spinel/actions/runs/41970163073');assert.equal(report.status,'passed');
for(const key of ['error','teardownError','fixtureTeardownError'])assert.equal(report[key],undefined);
const stages=report.stages; const named=(n:string)=>stages.filter((s:any)=>s.name===n);const one=(n:string)=>{const s=named(n);assert.equal(s.length,1,n);return s[0];};
for(const name of ['all-four-downloads-complete','exact-records-captured-before-quit','offline-catalog-and-original-records-retained','native-offline-edits-committed','complete'])one(name);
assert.equal(report.launches.length,4);assert.equal(new Set(report.launches.map((l:any)=>l.browserPid)).size,4);
const stops=stages.filter((s:any)=>s.name.startsWith('browser-stop'));assert.equal(stops.length,4);
for(const [i,l] of report.launches.entries()){assert.deepEqual(l.profile,report.launches[0].profile);assert.equal(l.version,report.release.installed);assert.equal(l.previousBrowserPid,i?report.launches[i-1].browserPid:null);assert.ok(stops.some((s:any)=>s.browserPid===l.browserPid&&s.driverPid===l.driverPid&&s.browserExited&&s.driverExited));}
assert.equal(stages.at(-1).name,'browser-stop');assert.equal(report.transport.activeBrowserSockets,0);
const retained=named('pending-restart-retained');assert.equal(retained.length,4);assert.equal(new Set(retained.map((s:any)=>s.itemId)).size,4);assert.deepEqual(retained.map((s:any)=>s.kind+':'+s.outcome).sort(),['doc:conflict','doc:normal','sheet:conflict','sheet:normal']);
const reconnect=named('normal-reconnect-exact-content-once');const conflicts=named('conflict-copy-preserves-original');assert.equal(reconnect.length,2);assert.equal(conflicts.length,2);
for(const s of [...reconnect,...conflicts]){const old=retained.find((r:any)=>r.itemId===s.itemId);assert.ok(old);assert.equal(s.images.length,3);assert.deepEqual(s.images.map((im:any)=>im.id).sort(),old.imageHashes.map((im:any)=>im.sha256).sort());for(const im of s.images){const raw=Buffer.from(im.bytes,'hex');assert.equal(hash(raw),im.id);assert.equal(raw.length,old.imageHashes.find((v:any)=>v.sha256===im.id).size);}}
for(const s of reconnect)assert.equal(s.revision,2);
for(const [i,s] of conflicts.entries()){assert.notEqual(s.itemId,s.copyId);assert.equal(s.receipts.length,i+1);assert.ok(s.receipts.some((r:any)=>r.item_id===s.copyId));assert.ok(s.receipts.every((r:any)=>r.user_id===report.actor.id&&r.possible_replay_crash===0));}
for(const s of [...retained,...conflicts]){assert.ok(members.some(m=>m.name==='chrome/'+s.visual.file));assert.equal(s.visual.captures,1);assert.ok(s.visual.colorPixelCounts.every((v:number)=>v>0));}
assert.equal(named('native-clipboard-content').length,6);for(const s of named('native-clipboard-content'))assert.ok(s.text.includes('731'));
const path='https://localhost:8176/_desktop-storage-loss';
for(const name of ['storage-loss-tabs-prepared','storage-loss-tabs-handed-off','storage-loss-tabs-restarted']){const s=one(name);const url=path+(name==='storage-loss-tabs-prepared'?'':'?phase=uncontrolled');assert.ok(s.after.length>0);assert.ok(s.after.every((u:string)=>new URL(u).origin!=='https://localhost:8176'||u===url));if(name==='storage-loss-tabs-handed-off'){assert.equal(s.documents.length,s.after.filter((u:string)=>u===url).length);assert.ok(s.documents.length>0);for(const d of s.documents)assert.deepEqual(d,{url,fresh:true,ready:'complete',marker:'inert',scripts:0,controller:null});}}
const prep=one('storage-loss-unregistration').preparation;const q=one('storage-loss-quiescence-before-stop').quiescence;const del=one('storage-deletion').deletion;
for(const s of [prep,q,del]){assert.equal(s.status,'passed');assert.equal(s.timeoutMs,28000);assert.ok(s.operations.every((o:any)=>o.status==='passed'));}
assert.deepEqual(q.operations.map((o:any)=>o.name),['verify-preparation-document','serviceWorker.getRegistrations','verify-uncontrolled']);assert.deepEqual(q.operations.at(-1).value,{workers:[],controller:null});assert.deepEqual(del.operations.find((o:any)=>o.name==='verify-uncontrolled').value,{workers:[],controller:null});
const order=['storage-loss-unregistration','storage-loss-tabs-handed-off','storage-loss-quiescence-before-stop','browser-stop-before-storage-loss','storage-loss-tabs-restarted','storage-deletion','cleared-storage-is-not-advertised','post-deletion-outage','missing-data-cannot-open-offline','complete'];for(let i=1;i<order.length;i++)assert.ok(stages.indexOf(one(order[i-1]))<stages.indexOf(one(order[i])));
const cache=del.operations.find((o:any)=>o.name==='caches.keys').value;assert.equal(del.operations.filter((o:any)=>o.name.startsWith('caches.delete:')).length,cache.length);for(const name of cache)assert.equal(del.operations.filter((o:any)=>o.name==='caches.delete:'+name&&o.value===true).length,1);
assert.equal(del.operations.filter((o:any)=>o.name==='localStorage.clear').length,1);assert.equal(del.database,'spinel-offline-'+report.actor.id);assert.equal(del.operations.filter((o:any)=>o.name==='indexedDB.deleteDatabase:'+del.database).length,1);
const empty=del.operations.at(-1).value;assert.deepEqual(empty.workers,[]);assert.deepEqual(empty.cacheNames,[]);assert.equal(empty.localStorageEntries,0);assert.ok(!empty.databases.includes(del.database));assert.deepEqual(one('cleared-storage-is-not-advertised').lost,{account:null,available:0});assert.match(one('missing-data-cannot-open-offline').message,/You're offline/);assert.match(one('missing-data-cannot-open-offline').message,/Connect to the internet/);assert.ok(!one('missing-data-cannot-open-offline').message.includes('Saved on this device'));
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();assert.equal(git('rev-parse','HEAD'),report.sourceSha);assert.equal(git('rev-parse','HEAD^{tree}'),'a2b37aa82336224ac40e92f7364e52ccebfb6d74');assert.equal(git('rev-parse',report.testedSha+'^{tree}'),git('rev-parse','HEAD^{tree}'));
writeFileSync(root+'/chrome-proof-a.json',JSON.stringify({status:'passed',source:report.sourceSha,tested:report.testedSha,tree:git('rev-parse','HEAD^{tree}'),run:report.run,attempt:report.attempt,zip:{bytes:zip.length,sha256:hash(zip)},members,stages:stages.length,profile:report.launches[0].profile,pids:report.launches.map((l:any)=>l.browserPid),version:report.release.installed,preparation:prep,quiescence:q,deletion:del,postLoss:one('missing-data-cannot-open-offline').message},null,2)+'\n');console.log('PASS current Chrome ZIP, all '+members.length+' members, identities and 44-stage semantics.');
