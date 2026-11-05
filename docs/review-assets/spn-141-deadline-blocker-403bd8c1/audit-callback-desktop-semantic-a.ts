import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { compareDocCallbackEvidence } from '/Users/mxbaylee/projects/spinel-spn-141/scripts/ci/doc-callback-comparison.ts';
const root='/tmp/spn141-after143-hosted';
const audit=JSON.parse(readFileSync(root+'/callback-desktop-audit-a.json','utf8'));
const jsonProofs=audit.proofs.filter((p:{file:string})=>p.file.endsWith('.json')&&!p.file.endsWith('.last-run.json'));
for(const proof of jsonProofs){
 let bytes=0;const hash=createHash('sha256');
 for await(const chunk of createReadStream(root+'/callback-desktop-retained/'+proof.file)){bytes+=chunk.length;hash.update(chunk);}
 assert.equal(bytes,proof.bytes,proof.file);assert.equal(hash.digest('hex'),proof.sha256,proof.file);
}
const manifests=jsonProofs.filter((p:{file:string})=>p.file.endsWith('/spn113-evidence.json')).map((p:{file:string})=>JSON.parse(readFileSync(root+'/callback-desktop-retained/'+p.file,'utf8')));
const baseline=manifests.find((m:any)=>m.role==='baselineObservation');
const candidate=manifests.find((m:any)=>m.role==='candidate');
const comparison=JSON.parse(readFileSync(root+'/callback-desktop-retained/test-results/spn113-comparison-desktop.json','utf8'));
const repeated=compareDocCallbackEvidence('desktop',{manifest:baseline,analysis:baseline.analysis,failures:[]},{manifest:candidate,analysis:candidate.analysis,failures:[]},audit.identities.tested);
assert.deepEqual(repeated,comparison);assert.equal(repeated.accepted,true);assert.deepEqual(repeated.failures,[]);
for(const m of manifests){assert.deepEqual(m.analysis.evidenceFailures,[]);if(m.role==='candidate')assert.deepEqual(m.analysis.candidateViolations,[]);}
const timing=audit.summaries.map((s:any)=>{
 const at=(phase:string)=>s.phaseEvents.find((e:any)=>e.phase===phase).atMs;
 return {role:s.role,behaviorCompleteMs:at('behavior-complete'),completionWaitMs:at('trace-stream-open')-at('trace-completion'),readCompressStoreMs:at('trace-stream-close')-at('trace-stream-read'),parseMs:at('trace-attribution')-at('trace-parse'),attributionMs:at('trace-analysis')-at('trace-attribution'),analysisMs:at('cdp-detach')-at('trace-analysis'),cleanupCompleteMs:at('fixture-cleanup-complete')};
});
const result={jsonFilesMatched:jsonProofs.length,comparisonAccepted:repeated.accepted,comparisonMatchesManifestAnalysis:true,rawAnalysisNotReparsed:true,timing};
writeFileSync(root+'/callback-desktop-semantic-a.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
