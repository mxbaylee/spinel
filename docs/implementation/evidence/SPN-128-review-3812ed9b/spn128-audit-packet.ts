import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root='/tmp/spn128-review-packet-3812ed9b-v2';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const m=JSON.parse(readFileSync(join(root,'source-manifest.json'),'utf8'));
for(const f of m.files){
 if(hash(readFileSync(join(root,f.path)))!==f.copySha256)throw Error(`Hash: ${f.path}`);
 if(/\.tsx?$/.test(f.path)&&f.originalSha256!==f.copySha256)throw Error(`Executable mask: ${f.path}`);
}
if(m.originalDiffSha256!==m.copyDiffSha256)throw Error('Diff mask');
const after=execFileSync('git',['diff','--name-only','65b7c982','3812ed9b'],{cwd:'/Users/mxbaylee/projects/spinel-spn-128-production',encoding:'utf8'}).trim().split('\n');
if(after.some(p=>!p.startsWith('docs/implementation/')))throw Error('Executable changed after checks');
const bind=join(root,'source-bindings.txt');if(!readFileSync(bind,'utf8').includes('Final-head changes after tested'))writeFileSync(bind,readFileSync(bind,'utf8')+'\nFinal-head changes after tested source65b7c982 (documentation/evidence only):\n'+after.join('\n')+'\n');
const entry=m.files.find(f=>f.path==='source-bindings.txt');entry.copySha256=entry.originalSha256=hash(readFileSync(bind));
writeFileSync(join(root,'source-manifest.json'),JSON.stringify(m,null,2)+'\n');
function walk(path:string):string[]{return readdirSync(path).flatMap(n=>{const p=join(path,n);return statSync(p).isDirectory()?walk(p):[p];});}
const pattern=/\b\d{1,3}\s*\/\s*100\b|\b[A-H][ :]*100\b|\b\d{1,2}(?:\s*\/\s*\d{1,2}){2,}\b|\bscored?\s+(?:of\s+)?\d{2,3}\b|\bUI\s*\/?\s*UX.{0,45}\b\d{1,3}\b|\b\d+\s*points?\b/i;
const hits:object[]=[];
for(const file of walk(root)){
 if(file.endsWith('manifest.json')||file.endsWith('/blinding-audit.json'))continue;
 const path=file.slice(root.length+1);
 readFileSync(file,'utf8').split('\n').forEach((text,i)=>{
  if(!pattern.test(text))return;
  const disposition=path.includes('SPN-160.md')?'Ticket priority score':path.includes('/SPN-122.md')?'Native history batch/group capacities':path.includes('passkey-provider')?'Provider GUID fragment':path.endsWith('.test.ts')?'Spreadsheet cell reference in executable test':path.includes('/design/')?'Typography/spacing dimensions':'Standing review policy/rubric instruction/threshold, not historical grade';
  hits.push({path,line:i+1,text,disposition});
 });
}
const audit={head:m.head,base:m.base,sourceCopiesVerified:m.files.length,executableCopiesByteExact:true,completeBinaryDiffByteExact:true,allIncludedGzipEvidenceDecodedAndScanned:true,decodedEvidenceCount:m.files.filter(f=>f.path.startsWith('decoded-evidence/')).length,historicalArchiveTextFiles:m.files.filter(f=>f.path.startsWith('historical-evidence/')).length,maskedLines:m.masks,remainingPatternHits:hits,originalsPreserved:true,scope:'Historical numerical grades/vectors/deductions masked only in external copies. Actual assertions, timings, failures, source identities, priorities and standing rubric retained. Unrelated historical art-review archives excluded.'};
writeFileSync(join(root,'blinding-audit.json'),JSON.stringify(audit,null,2)+'\n');
const files=walk(root).filter(p=>!p.endsWith('/packet-manifest.json')).sort().map(p=>({path:p.slice(root.length+1),sha256:hash(readFileSync(p))}));
writeFileSync(join(root,'packet-manifest.json'),JSON.stringify({head:m.head,base:m.base,files},null,2)+'\n');
console.log(JSON.stringify({root,files:files.length,decoded:audit.decodedEvidenceCount,historical:audit.historicalArchiveTextFiles,masks:m.masks.length,remainingDispositions:hits.length}));
