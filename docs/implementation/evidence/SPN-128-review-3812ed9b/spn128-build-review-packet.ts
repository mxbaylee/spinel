import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const cwd='/Users/mxbaylee/projects/spinel-spn-128-production';
const packet='/tmp/spn128-review-packet-3812ed9b-v2';
const head='3812ed9b153237b3b6da75fdbf31319f67844d19';
const base='ec42f0741415e4e712395fb47c30b911bc4e64ea';
const git=(...a:string[])=>execFileSync('git',a,{cwd,maxBuffer:150*1024*1024});
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const writes:object[]=[]; const masks:object[]=[];const omitted:object[]=[];
const implementation=new Set(['README.md','SPN-112.md','SPN-115.md','SPN-124.md','SPN-125.md','SPN-128.md','SPN-131.md','SPN-138.md','SPN-158.md','SPN-160.md','backlog-workflow.md','grooming-2026-10-26.md','grooming-2026-10-29.md','grooming-2026-11-02.md','grooming-2026-11-14.md']);
const policy=(p:string)=>/(?:AGENTS\.md|docs\/(?:run-backlog\.md|todo\/process\.md|implementation\/(?:backlog-workflow|grooming-2026-11-02)\.md))$/.test(p);
function blind(text:string,path:string){
 if(policy(path)||path.endsWith('.github/pull_request_template.md')||path.includes('/docs/todo/'))return text;
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
  omitted.push({...e,sha256:hash(data),reason:'Unchanged binary resource; exact bytes remain in git; complete changed binary patch supplied'});continue;
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
put('base-ticket.md',git('show',`${base}:docs/todo/SPN-128.md`),{source:base,sourcePath:'docs/todo/SPN-128.md'});
put('source-bindings.txt',Buffer.from([
`HEAD ${head}`,`BASE ${base}`,`TREE ${git('rev-parse',`${head}^{tree}`).toString().trim()}`,
'All executable source copies are byte-exact git blobs. Documentation masks do not alter originals.',
'Parent graph:',git('log','-4','--format=%H %P %s',head).toString(),
'Full changed-file accounting:',git('diff','--numstat',base,head).toString(),
'Main-only integration delta in crash harness (SPN-158 preserved):',git('diff','c04aba84', '65b7c982','--','src/server/maintenance/restore-crash.integration.test.ts').toString(),
'Original authority and cold restart clock bindings:',git('grep','-n','-E','expiredRestoreClockOffset|CLOCK_OFFSET|Date.now =|grantedAt.*toBeGreaterThan|RESTORE_OPERATION_MS =',head,'--','src/shared/restore.ts','src/server/maintenance/restore-crash-clock-fixture.ts','src/server/maintenance/restore-crash-clock.test.ts','src/server/maintenance/restore-crash.integration.test.ts','src/server/maintenance/restore-crash-fixture.ts','src/server/maintenance/restore-crash-app-fixture.ts').toString(),
].join('\n')),{head,base});
writeFileSync(join(packet,'source-manifest.json'),JSON.stringify({head,base,tree:git('rev-parse',`${head}^{tree}`).toString().trim(),files:writes,omitted,masks,originalDiffSha256:hash(diff),copyDiffSha256:hash(readFileSync(join(packet,'candidate.diff'))),policy:'Full committed executable text, relevant decision/policy docs, complete binary diff, all SPN-128 gzip evidence decoded, three immutable historical archives supplied. Only historical numerical assessments masked in external copies. Standing rubric/policy preserved. Original source and evidence untouched.'},null,2)+'\n');
console.log(JSON.stringify({packet,files:writes.length,masks:masks.length,omitted:omitted.length}));
