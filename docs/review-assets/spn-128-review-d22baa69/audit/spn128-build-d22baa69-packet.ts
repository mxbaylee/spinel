import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const cwd='/Users/mxbaylee/projects/spinel-spn-128-production';
const packet='/tmp/spn128-review-packet-d22baa69';
const head='d22baa6997e27c123ef351a8f5321089cc9e345b';
const base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d';
const git=(...a:string[])=>execFileSync('git',a,{cwd,maxBuffer:150*1024*1024});
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const writes:object[]=[]; const masks:object[]=[];const omitted:object[]=[];
const implementation=new Set(['README.md','SPN-090.md','SPN-090-startup-acceptance.md','SPN-090-startup-build.md','SPN-090-renderer-boundary.md','SPN-112.md','SPN-115.md','SPN-120.md','SPN-123.md','SPN-124.md','SPN-125.md','SPN-128.md','SPN-131.md','SPN-138.md','SPN-158.md','SPN-160.md','backlog-workflow.md','grooming-2026-10-26.md','grooming-2026-10-29.md','grooming-2026-11-02.md','grooming-2026-11-14.md']);
const policy=(p:string)=>/(?:AGENTS\.md|docs\/(?:run-backlog\.md|todo\/process\.md|implementation\/(?:backlog-workflow|grooming-2026-11-02)\.md))$/.test(p);
function blind(text:string,path:string){
 if(policy(path)||path.endsWith('.github/pull_request_template.md')||path.includes('/docs/todo/')||/SPN-090[^/]*\.md$/.test(path))return text;
 return text.split('\n').map((line,i)=>{
  const original=line;
  if(path.endsWith('SPN-160.md')&&line.includes('first: score 33'))return line;
  line=line.replace(/\b(?:[0-9]{1,3}\s*\/\s*)+[0-9]{1,3}\s*\/\s*100\b/g,'[historical assessment masked]');
  line=line.replace(/\b[0-9]{1,3}\s*\/\s*100\b/g,'[historical assessment masked]');
  line=line.replace(/\b(scored?\s+(?:of\s+)?|grade(?:d)?\s*(?:of\s+|:\s*)?)([0-9]{2,3})\b/gi,'$1[historical assessment masked]');
  line=line.replace(/\b([A-H])\s*:?\s*100\b/g,'$1 [historical assessment masked]');
  if(/review|rubric|score|grade|assessment|UI\s*\/?\s*UX/i.test(line)){
   line=line.replace(/\b\d{1,2}(?:\s*\/\s*\d{1,2}){2,}\b/g,'[historical rubric vector masked]');
   line=line.replace(/\b(\d{1,2})\s*\/\s*(35|25|20|10)\b/g,'[historical rubric allocation masked]');
  }
  if(path.endsWith('component-review.md')&&i>=589&&i<=660) {
   line=line.replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) points?\b/gi,'[historical deduction masked]').replace(/[−–]\d+\b/g,'[historical deduction masked]');
  }
  if(line!==original)masks.push({path,line:i+1});
  return line;
 }).join('\n');
}
function put(path:string,data:Buffer,identity:object,allowBlind=true){
 let final=data;
 const text=data.toString('utf8');
 const isText=!data.includes(0)&&Buffer.from(text).equals(data);
 if(isText&&allowBlind) final=Buffer.from(blind(text,path));
 mkdirSync(dirname(join(packet,path)),{recursive:true});writeFileSync(join(packet,path),final);
 writes.push({path,...identity,originalSha256:hash(data),copySha256:hash(final),masked:!data.equals(final)});
}
const entries=git('ls-tree','-rlz',head).toString().split('\0').filter(Boolean).map(x=>{const [meta,path]=x.split('\t');const [mode,type,blob,size]=meta.trim().split(/\s+/);return {mode,type,blob,size:Number(size),path};});
for(const e of entries){
 const p=e.path;
 if(p.startsWith('docs/design/review/')||p.startsWith('docs/grooming/'))continue;
 if(p.startsWith('docs/implementation/')&&!p.startsWith('docs/implementation/evidence/SPN-128')&&!implementation.has(p.slice('docs/implementation/'.length)))continue;
 if(p.startsWith('docs/review-assets/'))continue;
 const data=readFileSync(join(cwd,p));
 const blob=createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
 if(blob!==e.blob)throw Error(`Noncommitted bytes: ${p}`);
 if(p.endsWith('.gz')){
  const decoded=gunzipSync(data);put('decoded-evidence/'+p.slice('docs/implementation/evidence/'.length,-3),decoded,{source:head,sourcePath:p,blob:e.blob,archiveSha256:hash(data)});
  omitted.push({...e,sha256:hash(data),reason:'Archive decoded for reviewer input; original preserved in committed source'});continue;
 }
 if(data.includes(0)||!Buffer.from(data.toString('utf8')).equals(data)){
  if(p.startsWith('docs/implementation/evidence/SPN-128-crash-retention-repair/')) {
   put('source/'+p,data,{source:head,sourcePath:p,blob:e.blob},false);
   if(p.endsWith('.zip')) {
    const members=execFileSync('unzip',['-Z1',join(cwd,p)],{encoding:'utf8'}).trim().split('\n');
    for(const member of members.filter(m=>!m.endsWith('/'))) {
     const raw=execFileSync('unzip',['-p',join(cwd,p),member],{maxBuffer:32*1024*1024});
     if(!raw.includes(0)&&Buffer.from(raw.toString('utf8')).equals(raw))put('decoded-zips/'+p.slice('docs/implementation/evidence/'.length)+'/'+member,raw,{source:head,sourcePath:p,member,archiveSha256:hash(data)});
     else omitted.push({source:head,path:p,member,sha256:hash(raw),reason:'Binary trace member preserved in exact ZIP source copy'});
    }
   }
  } else omitted.push({...e,sha256:hash(data),reason:'Binary resource; exact bytes remain in Git and changed bytes in complete binary patch'});
  continue;
 }
 put('source/'+p,data,{source:head,sourcePath:p,blob:e.blob},!p.endsWith('.ts')&&!p.endsWith('.tsx'));
}
for(const [sha,label,folder] of [
 ['7447da12a6c1a2f29c4b4d9b870b901f15c501bb','local-2fcbbec7','docs/review-assets/spn-128-current-local'],
 ['ba5c9fd5868e5448882e976edc202ede4b234dd3','local-a6dd085d','docs/review-assets/spn-128-current-local'],
 ['41e2a2868be914adec6da5eeccc0faba589c3ef2','previous-ci-740e97cc','docs/review-assets/spn-128-previous-ci']]){
 for(const path of git('ls-tree','-r','--name-only',sha,folder).toString().trim().split('\n')){
  const data=git('show',`${sha}:${path}`);const dest=`historical-evidence/${label}/${path.slice(folder.length+1)}`;
  if(path.endsWith('.gz'))put(dest.slice(0,-3),gunzipSync(data),{source:sha,sourcePath:path,archiveSha256:hash(data)});
  else if(!data.includes(0))put(dest,data,{source:sha,sourcePath:path});
  else omitted.push({source:sha,path,sha256:hash(data),reason:'binary historical artifact inventoried'});
 }
}
const diff=git('diff','--binary','--full-index',base,head);
put('candidate.diff',diff,{base,head,kind:'complete binary diff'},true);
put('repair-executable.diff',git('diff','--full-index','628d7798',head,'--',':!docs',':!*.md'),{source:head,priorReviewed:'628d77987e7d9a08863465a7553a2ed82579728b'},false);
put('original-ticket.md',git('show','18a8759c498574a1d9cc24a969a558cd97a798ed:docs/todo/SPN-128.md'),{source:'18a8759c498574a1d9cc24a969a558cd97a798ed',sourcePath:'docs/todo/SPN-128.md'});
put('base-ticket.md',git('show',`${base}:docs/todo/SPN-128.md`),{source:base,sourcePath:'docs/todo/SPN-128.md'});
put('source-bindings.txt',Buffer.from([
`HEAD ${head}`,`BASE ${base}`,`TREE ${git('rev-parse',`${head}^{tree}`).toString().trim()}`,
'All executable source copies are byte-exact git blobs. Documentation masks do not alter originals.',
'Parent graph:',git('log','-5','--format=%H %P %s',head).toString(),
'Full changed-file accounting:',git('diff','--numstat',base,head).toString(),
'Main-only integration delta in crash harness (SPN-158 preserved):',git('diff','c04aba84', '65b7c982','--','src/server/maintenance/restore-crash.integration.test.ts').toString(),
'SPN-090 incoming integration source proof: see source/docs/implementation/evidence/SPN-128-c1-integration/source-only-audit.json and completed-source-audit.json. All61 incoming non-document files match c1; all180 audited recovery paths match prior reviewed3812.',
'SPN-120/123 actual-main original integration audit remains source-qualified: source/docs/implementation/evidence/SPN-128-8e9-integration/. It is an earlier stage, not final repair equality. Repair source-tested524dca9e; finald22baa69 adds documentation/evidence only. Current repair provenance and complete input bindings: source/docs/implementation/evidence/SPN-128-crash-retention-repair/provenance.json and decoded-evidence/SPN-128-crash-retention-repair/source-bindings.json.',
'Final executable equivalence proof:',git('diff','--name-status','524dca9e',head,'--',':!docs').toString(),
'Separate browser probe source-equivalence:',git('diff','--name-status','8eca70fe',head,'--','e2e/supervised-restore-tracing.ts','e2e/supervised-restore.spec.ts').toString(),
'Original authority and cold restart clock bindings:',git('grep','-n','-E','expiredRestoreClockOffset|CLOCK_OFFSET|Date.now =|grantedAt.*toBeGreaterThan|RESTORE_OPERATION_MS =',head,'--','src/shared/restore.ts','src/server/maintenance/restore-crash-clock-fixture.ts','src/server/maintenance/restore-crash-clock.test.ts','src/server/maintenance/restore-crash.integration.test.ts','src/server/maintenance/restore-crash-fixture.ts','src/server/maintenance/restore-crash-app-fixture.ts').toString(),
].join('\n')),{head,base});

put('current-pr-check.log',readFileSync('/tmp/spn128-crash-repair-checks/final-pr.log'),{source:head,kind:'exact-head PR shape outcome'},false);
put('current-pr-check-guard.json',readFileSync('/tmp/spinel-dependabot-2026-11-11/spn128-crash-final-pr.json'),{source:head,kind:'exact-head PR shape guard'},false);
put('review-input.md',Buffer.from(`# SPN-128 complete repaired outcome

Reviewed source candidate: ${head}. Actual main base: ${base}. Same PR229, source repair branch codex/spn-128-crash-evidence. No validation push of this repair has occurred.

Review the full original L recovery outcome, original/base tickets, canonical decisions/personas, complete binary diff, all authority/custody/process/native acceptance and final repair. The repair closes original628d retained-cut evidence and trace ownership/upload gaps. Two pre-freeze reviewer findings are preserved and repaired: per-controller SIGKILL and observations-before-assertions. Original local type and privacy-fixture failures and all changed-source checks are retained, with exact source identities in provenance. Grade-free means prior historical numerical assessments are masked in external copies only; originals are unchanged. No desired scores or peer results are included.

Final count: 14,082 textual changed lines (soft threshold warning; complete outcome retained). Final head differs from tested524dca9e only in docs/evidence. Types/lint pass there; eleven receipt controls on3e5b929c differ only by following test formatting. Portable recovery30pass/21existingLinuxskips and routing17pass are earlier source-qualified. Actual real Playwright controls: two trace-ownership controls at20caeb5e and one named-artifact/capture-failure/upload-glob control at8eca70fe. The latter browser source is unchanged at final head. They do not substitute for full Linux or native acceptance.

Original628d CI is terminal failed: supervised catalog tracing collision (all three attempts), callback baseline postprocessing timeout (behavior completed, cleanup confirmed), and aggregate failure. Other selected completed outcomes remain useful but are not current repaired-head passes. No budget increase, unchanged manual retry, or source-cause claim for callback. Both reviewers must independently inspect the entire outcome and run feasible related checks serially under root's workload grant. All seven required gates plus selected hosted owners remain pending on this repair.

Prior published immutable review archives are links only, not recursive packet copies: 2fd164eefdf0302b9d3e3a3cfab4c25bb6905507 (628d), 568c42e30022e9dadb3f6c9f84d7fa979b76fe7e (8184), ba660d31d96949680e48ba44f33e2a46caac0dd8 (3812). Original historical local and CI evidence text remains supplied from the same exact references as the prior packet.
`),{source:head,base},false);
writeFileSync(join(packet,'source-manifest.json'),JSON.stringify({head,base,tree:git('rev-parse',`${head}^{tree}`).toString().trim(),files:writes,omitted,masks,originalDiffSha256:hash(diff),copyDiffSha256:hash(readFileSync(join(packet,'candidate.diff'))),policy:'Full committed executable text, relevant decision/policy docs, complete binary diff, all SPN-128 gzip evidence decoded, three immutable historical archives supplied. Only historical numerical assessments masked in external copies. Standing rubric/policy preserved. Original source and evidence untouched.'},null,2)+'\n');
console.log(JSON.stringify({packet,files:writes.length,masks:masks.length,omitted:omitted.length}));
