import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
const root='/tmp/spn128-terminal-d22baa69/audit-output';
const audit=JSON.parse(fs.readFileSync(`${root}/crash-receipts.json`,'utf8'));
const sha=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(audit.artifact.path)),audit.artifact.sha256);
execFileSync('unzip',['-t',audit.artifact.path],{stdio:'pipe'});
const receipts:any[]=[];
for(const binding of audit.bindings){
 const b=execFileSync('unzip',['-p',audit.artifact.path,binding.member]);
 assert.equal(b.length,binding.bytes);assert.equal(sha(b),binding.sha256);
 const j=JSON.parse(b.toString());
 if(binding.member==='source.json')continue;
 assert.equal(j.source.head,audit.source);assert.equal(j.source.tested,audit.tested);assert.equal(j.source.tree,audit.tree);assert.equal(j.source.run,String(audit.run));assert.equal(j.source.attempt,'1');
 assert.equal(j.result,'passed');assert.equal(j.primaryFailure,null);assert.deepEqual(j.secondaryFailures,[]);assert.deepEqual(j.cleanup,{closure:'passed',temporaryData:'removed'});
 const killed=j.controllers.filter((c:any)=>c.initial||c.cold);
 for(const controller of killed){assert.equal(controller.signal,'SIGKILL');assert(j.terminations.some((t:any)=>t.pid===controller.pid&&t.action==='sigkill'&&t.released));}
 const cut=j.snapshots.find((s:any)=>s.stage==='cut');
 const final=j.snapshots.find((s:any)=>s.stage==='completed');assert(cut);assert(final);assert.equal(final.authority.currentAuthority,'none');assert.equal(final.authority.currentOperationMatches,false);
 const recovered=j.snapshots.find((s:any)=>s.stage==='recovered');
 if(recovered){assert.equal(recovered.fingerprints.liveBoundary,'closed-read-only-probe');assert.equal(recovered.fingerprints.live,recovered.fingerprints.outcome);}
 for(const snap of j.snapshots){for(const grant of snap.authority.cold){assert(grant.grantedAt>snap.authority.originalExpiresAt);assert.equal(grant.deadline-grant.grantedAt,90000);}}
 receipts.push({case:j.case,initialPhase:cut.phase,finalPhase:final.phase,killedControllers:killed.length,observedOriginal:j.observedFrozen,recoveredFingerprint:recovered?.fingerprints.live,completedLive:final.fingerprints.live,cleanup:j.cleanup});
}
assert.equal(receipts.length,17);assert.equal(new Set(receipts.map(r=>r.case)).size,17);
const log=zlib.gunzipSync(fs.readFileSync(audit.executionEvidence.path));assert.equal(sha(log),audit.executionEvidence.rawSha256);assert.equal(audit.executionEvidence.observed.length,17);
const result={at:new Date().toISOString(),source:audit.source,tested:audit.tested,run:audit.run,artifact:audit.artifact,receipts,rawLogSHA:sha(log),scope:'Root independently verified original bytes and source identities,17 actual controller kills/cleanup/authority/projected fingerprint receipts. Read cold-commit and postcommit in full. Broader native and all gates remain separate.'};
fs.writeFileSync('/tmp/spn128-root-crash-receipts-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({receipts:receipts.length,artifactSHA:audit.artifact.sha256,rawLogSHA:sha(log)}));
