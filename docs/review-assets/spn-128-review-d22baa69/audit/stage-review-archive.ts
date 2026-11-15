/** Prepare byte-exact review preservation only; no Git writes, refs, push or metadata. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,lstatSync,mkdtempSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const staging='/tmp/spn128-preservation-d22baa69', input=JSON.parse(readFileSync(join(staging,'inputs.json'),'utf8'));
const source='d22baa6997e27c123ef351a8f5321089cc9e345b',base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d',packet='/tmp/spn128-review-packet-d22baa69';
const root=join(staging,'archive'),cwd='/Users/mxbaylee/projects/spinel-spn-128-production';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
if(input.source!==source||input.base!==base)throw Error('Source binding mismatch');
if(input.reviews.length!==2||input.reviews.some((r:{report:string|null;source:string;originals:string[]})=>!r.report||r.source!==source||!r.originals.length))throw Error('Await both exact-head original reports and raw provenance');
if(!input.rootPacketAudit||!input.rootSourceAudit||!input.rootReadBothReports)throw Error('Await root audits and full report reading');
if(execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim()!==source||execFileSync('git',['status','--porcelain'],{cwd,encoding:'utf8'}).trim())throw Error('Candidate changed');
if(existsSync(root))throw Error('Archive stage already exists; preserve any previous preparation');
mkdirSync(root);const originals:object[]=[];
function copy(path:string,dest:string){const bytes=readFileSync(path);if(existsSync(join(root,dest)))throw Error('Duplicate archive destination '+dest);mkdirSync(dirname(join(root,dest)),{recursive:true});writeFileSync(join(root,dest),bytes);originals.push({originalPath:path,archivePath:dest,bytes:bytes.length,sha256:hash(bytes)});}
for(const r of input.reviews){copy(r.report,'reviews/'+r.report.split('/').at(-1));for(const path of r.originals)copy(path,'execution/'+r.agent+'/'+path.replace(/^\/tmp\//,''));}
for(const path of new Set<string>([input.rootPacketAudit,input.rootSourceAudit,...input.supplements]))copy(path,'audit/'+path.split('/').at(-1));
for(const name of ['source-manifest.json','source-bindings.txt','review-input.md','current-pr-check.log','current-pr-check-guard.json'])copy(join(packet,name),'packet-bindings/'+name);
copy(join(staging,'stage-review-archive-first.ts'),'audit/stage-review-archive-first.ts');
copy(join(staging,'stage-review-archive.ts'),'audit/stage-review-archive.ts');copy(join(staging,'inputs.json'),'audit/inputs.json');
const archive=join(root,'review-packet-d22baa69.tar.gz');
execFileSync('tar',['-czf',archive,'-C',packet,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
// Validate the freshly generated, task-owned TAR with standard tar and TypeScript.
const inventory=(directory:string):Map<string,'file'|'directory'>=>{
 const entries=new Map<string,'file'|'directory'>([['.','directory']]);
 const visit=(parent:string,prefix:string)=>{for(const name of readdirSync(parent)){
  const full=join(parent,name),relative=prefix?prefix+'/'+name:name,info=lstatSync(full);
  if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('Unsupported packet entry '+relative);
  entries.set(relative,info.isDirectory()?'directory':'file');if(info.isDirectory())visit(full,relative);
 }};visit(directory,'');return entries;
};
const expected=inventory(packet);
const memberNames=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trimEnd().split('\n');
const verbose=execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}).trimEnd().split('\n');
if(memberNames.length!==verbose.length)throw Error('TAR listing mismatch');
const seen=new Set<string>();
for(let i=0;i<memberNames.length;i++){
 const raw=memberNames[i];
 if(raw.startsWith('/')||raw.includes('\\')||raw.split('/').includes('..'))throw Error('Unsafe TAR member');
 const name=raw.replace(/^\.\//,'').replace(/\/$/,'')||'.';
 if(seen.has(name)||!expected.has(name))throw Error('Unexpected or duplicate TAR member '+name);
 const kind=verbose[i][0];if(kind!=='-'&&kind!=='d')throw Error('TAR link/special entry refused '+name);
 if((kind==='d'?'directory':'file')!==expected.get(name))throw Error('TAR entry type mismatch '+name);
 seen.add(name);
}
if(seen.size!==expected.size)throw Error('TAR member omission');
const extracted=mkdtempSync(join(staging,'packet-verification-'));
execFileSync('tar',['-xzf',archive,'-C',extracted],{env:{...process.env,COPYFILE_DISABLE:'1'}});
const actual=inventory(extracted);
if(actual.size!==expected.size)throw Error('Extracted membership mismatch');
let files=0;
for(const [name,kind] of expected){
 if(actual.get(name)!==kind)throw Error('Extracted type mismatch '+name);
 if(kind==='file'){if(!readFileSync(join(packet,name)).equals(readFileSync(join(extracted,name))))throw Error('TAR bytes mismatch '+name);files++;}
}
const verification=JSON.stringify({files,allMemberBytesExact:true,sha256:hash(readFileSync(archive)),verifiedWith:'TypeScript lstat/byte comparison and standard tar CLI',verificationDirectory:extracted});
writeFileSync(join(root,'packet-archive-verification.json'),verification+'\n');
writeFileSync(join(root,'provenance.json'),JSON.stringify({source,base,plannedDirectParent:source,exclusivePrefix:input.exclusivePrefix,reviews:input.reviews,originals,packetManifestSha256:hash(readFileSync(join(packet,'source-manifest.json'))),historicalArchiveLinks:input.historicalArchiveLinks,original628dTerminalArchive:input.original628dTerminalArchive,limits:input.limits},null,2)+'\n');
writeFileSync(join(root,'README.md'),`# 🌷 Repaired SPN-128 review evidence\n\nThis evidence archive preserves the complete independent review of source ${source}, actual base ${base}. Its files belong exclusively under ${input.exclusivePrefix}; the reviewed implementation remains unchanged. Commit ancestry and publication identity are recorded by the separate seal receipt.\n\nThe full grade-free packet is an exact TAR. Original current reports and all original execution/provenance files are separate and byte-exact, including first failures and resource/preflight limits. Published historical archives are linked, not recursively recopied. Current reports assess the complete L recovery outcome and this repair; scores do not establish hosted acceptance.\n\nOriginal628d missed retained-cut acceptance and its actual hosted trace collision/callback postprocessing failure remain historical failures. The pre-freeze SIGKILL and observation-order findings and local type/privacy-fixture failures are preserved in the candidate. Fresh repaired-head hosted acceptance remains pending.\n\n${input.historicalArchiveLinks.map((x:string)=>'- '+x).join('\n')}\n`);
const walk=(p:string):string[]=>readdirSync(p).flatMap(n=>{const f=join(p,n);return statSync(f).isDirectory()?walk(f):[f];});
writeFileSync(join(root,'manifest.json'),JSON.stringify({source,base,files:walk(root).sort().map(p=>({path:p.slice(root.length+1),sha256:hash(readFileSync(p)),bytes:statSync(p).size}))},null,2)+'\n');
console.log(JSON.stringify({root,source,base,status:'Staged only; root audit/seal still required',manifestSha256:hash(readFileSync(join(root,'manifest.json'))),packet:JSON.parse(verification)}));
