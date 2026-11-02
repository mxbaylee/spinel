import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateAuditReport} from '/Users/mxbaylee/projects/spinel-spn-120/scripts/ci/fixture-audit.ts';
import type {AuditProject} from '/Users/mxbaylee/projects/spinel-spn-120/scripts/ci/fixture-audit.ts';
const [root,sha,run]=process.argv.slice(2);
const files=fs.readdirSync(root,{recursive:true}).map(String);
let total=0;const summaries=[];
for(const resultPath of files.filter(f=>f.endsWith('/fixture-audit/results.json'))){
 const base=path.join(root,path.dirname(path.dirname(resultPath)));
 const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(base,p),'utf8'));
 const result=read('fixture-audit/results.json');
 const project=result.project as AuditProject;
 assert.equal(result.sourceSha,sha);assert.equal(result.workflowRunId,run);assert.equal(result.workflowRunAttempt,'1');
 assert.equal(result.setupRecoveryAllowed,false);assert.equal(result.complete,true);
 const ids=read('fixture-audit/attempt-identities.json');
 const validated=validateAuditReport(read(`playwright-report/${project}.json`),project,ids);
 assert.equal(validated.complete,true,JSON.stringify(validated.reasons));
 const journals=fs.readdirSync(base,{recursive:true}).map(String).filter(f=>f.endsWith('/fixture-evidence.json')).map(read);
 assert.equal(journals.length,ids.length);
 for(const id of ids){
  const matching=journals.filter(j=>j.testId===id.testId&&j.repeatEachIndex===id.repeatEachIndex&&j.retry===0&&j.project===project);
  assert.equal(matching.length,1);const j=matching[0];assert.equal(j.sourceSha,sha);assert.equal(j.dropped,0);
  assert.equal(j.events[0].phase,'server-ready');assert.equal(j.events.at(-1).phase,'scenario-finished');
  const cleanup=j.events.filter((e:any)=>e.phase==='cleanup');assert.equal(cleanup.length,1);assert.equal(cleanup[0].errors,0);
  for(const e of j.events.filter((e:any)=>e.phase==='authenticated-setup')){assert.equal(e.attempt,1);assert.equal(e.result,'verified');assert.equal(e.identityMatch,true);}
  for(const e of j.events.filter((e:any)=>e.server)){assert.equal(e.server.ready,true);assert.equal(e.server.unexpectedExit,false);assert.equal(e.server.firstFailure,null);}
 }
 const serverFile=fs.readdirSync(path.join(base,'playwright-report')).find(f=>/^server-\d+\.json$/.test(f));assert.ok(serverFile);
 const server=read(`playwright-report/${serverFile}`);assert.equal(server.expectedClose,true);assert.equal(server.closed,true);assert.equal(server.unexpectedExit,false);assert.equal(server.firstFailure,null);
 total+=ids.length;summaries.push({project,attempts:ids.length,node:result.node,browser:result.browserVersion,sourceTree:result.sourceTree,startedAt:result.startedAt,finishedAt:result.finishedAt});
}
assert.equal(total,24);assert.equal(summaries.length,3);console.log(JSON.stringify({sourceSha:sha,run,attempt:1,total,complete:true,summaries},null,2));
