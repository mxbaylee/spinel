import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { coveragePlan, suiteIds, verifyCoverage } from '/Users/mxbaylee/projects/spinel-spn-123-production/scripts/ci/plan.ts';
const base = 'ec42f0741415e4e712395fb47c30b911bc4e64ea';
const git = (...args: string[]) => execFileSync('git', args, {encoding:'utf8'}).trim();
const head=git('rev-parse','HEAD');
assert.equal(head,'6ef945eae3168da7f3706088dc7c2b78fad39cd5');
assert.equal(git('status','--porcelain'),'');
for (const args of [
 ['scripts/backlog/cli.ts','check'],
 ['scripts/backlog/cli.ts','pr','--base',base,'--title','📊 SPN-123 Complete operation and sync diagnostic coverage'],
]) execFileSync(process.execPath,args,{stdio:'inherit'});
git('diff','--check',base,head);
const paths=git('diff','--no-renames','--name-only',base,head).split('\n');
const event={action:'synchronize',pull_request:{base:{sha:base},head:{sha:head},labels:[]}};
const plan=coveragePlan('pull_request',event,paths,head);
assert.ok(suiteIds.every(id=>plan.suites[id].selected));
const success=Object.fromEntries(suiteIds.map(id=>[id,'success']));
assert.equal(verifyCoverage(plan,'success',success,suiteIds).length,15);
let rejected=0;
for(const id of suiteIds) for(const status of [undefined,'skipped','failure','cancelled']) {
 assert.throws(()=>verifyCoverage(plan,'success',{...success,[id]:status},suiteIds));rejected++;
}
const sourcePaths=[
 'lib/diagnostics/client.ts','lib/sync-client/src/client.ts','lib/sync-client/src/pending-buffer.ts',
 'web/diagnostics.ts','web/offline/OfflineSession.ts','web/spinelSync.ts','src/ui/boundedDocHistory.ts',
 'src/server/diagnostics/routes.ts','src/server/diagnostics/store.ts','src/server/history/store.ts',
 'src/server/maintenance/supervisor.ts','server/app.ts','e2e/diagnostics.spec.ts','scripts/dependencies/patch-univer-docs.ts',
 'package-lock.json','vitest.config.ts',
];
const sourceCases=sourcePaths.map(path=>{
 const p=coveragePlan('pull_request',event,[path],head);
 for(const id of ['unit-tests','playwright-run','doc-responsiveness','doc-callback-lifetimes'] as const) assert.ok(p.suites[id].selected,path+':'+id);
 // The diagnostics-only browser fixture does not own sized restore. All
 // runtime/shared inputs below do; the full actual diff still selects restore.
 if(path!=='e2e/diagnostics.spec.ts') assert.ok(p.suites['restore-timing'].selected,path);
 if(path.startsWith('lib/')||path.startsWith('scripts/dependencies/')||['package-lock.json','vitest.config.ts'].includes(path)) assert.ok(p.suites['lib-test-run'].selected,path);
 return {path,selected:suiteIds.filter(id=>p.suites[id].selected)};
});
const digest=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const output='/tmp/spinel-dependabot-2026-11-11/spn123-ec42-policy-result.json';
writeFileSync(output,JSON.stringify({base,head,tree:git('rev-parse','HEAD^{tree}'),plan,planSha256:digest,selectedSuites:15,rejectedSelectedResults:rejected,sourceCases,scriptSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),scope:'Local same-source classifier/negative evidence, not an actual hosted plan or CI result'},null,2)+'\n');
console.log(JSON.stringify({head,paths:paths.length,selected:15,rejected,sourceCases:sourceCases.length,output}));
