import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
const dir='/tmp/spn128-preservation-d22baa69',path=join(dir,'stage-review-archive.ts');
let s=readFileSync(path,'utf8').replace('statSync,existsSync','statSync,lstatSync,mkdtempSync,existsSync');
const start=s.index("const verification=execFileSync('python3'");const end=s.index("writeFileSync(join(root,'packet-archive-verification.json')",start);
if(start<0||end<0)throw Error('Original verification block missing');
s=s.slice(0,start)+`// Validate the freshly generated, task-owned TAR with standard tar and TypeScript.
const inventory=(directory:string):Map<string,'file'|'directory'>=>{
 const entries=new Map<string,'file'|'directory'>([['.','directory']]);
 const visit=(parent:string,prefix:string)=>{for(const name of readdirSync(parent)){
  const full=join(parent,name),relative=prefix?prefix+'/'+name:name,info=lstatSync(full);
  if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('Unsupported packet entry '+relative);
  entries.set(relative,info.isDirectory()?'directory':'file');if(info.isDirectory())visit(full,relative);
 }};visit(directory,'');return entries;
};
const expected=inventory(packet);
const memberNames=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trimEnd().split('\\n');
const verbose=execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}).trimEnd().split('\\n');
if(memberNames.length!==verbose.length)throw Error('TAR listing mismatch');
const seen=new Set<string>();
for(let i=0;i<memberNames.length;i++){
 const raw=memberNames[i];
 if(raw.startsWith('/')||raw.includes('\\\\')||raw.split('/').includes('..'))throw Error('Unsafe TAR member');
 const name=raw.replace(/^\\.\\//,'').replace(/\\/$/,'')||'.';
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
`+s.slice(end);
s=s.replace('Prepared for an evidence-only direct child of reviewed source ${source}, actual base ${base}, exclusively ${input.exclusivePrefix}. This staging helper creates no commit or ref and does not change the candidate.', 'This evidence archive preserves the complete independent review of source ${source}, actual base ${base}. Its files belong exclusively under ${input.exclusivePrefix}; the reviewed implementation remains unchanged. Commit ancestry and publication identity are recorded by the separate seal receipt.')
s=s.replace('copy(join(staging,\'stage-review-archive.ts\'),',"copy(join(staging,'stage-review-archive-first.ts'),'audit/stage-review-archive-first.ts');\ncopy(join(staging,'stage-review-archive.ts'),");
writeFileSync(path,s);
const input=JSON.parse(readFileSync(join(dir,'inputs.json'),'utf8'));
input.rootPacketAudit='/tmp/spn128-root-packet-audit-d22baa69.json';
input.supplements.push('/tmp/spn128-root-packet-d22baa69-audit.ts','/tmp/spn128-root-packet-d22baa69-audit-first.ts','/tmp/spn128-root-terminal-audit-628d7798.json','/tmp/spn128-root-terminal-628d-audit.ts');
input.original628dTerminalArchive={commit:'5d186e11fba730d346e9e963d99b50ce2f1e96f8',tag:'archive/spn-128-validation-628d7798-20261114',published:true,url:'https://github.com/mxbaylee/spinel/tree/5d186e11fba730d346e9e963d99b50ce2f1e96f8/docs/review-assets/spn-128-validation-628d7798',manifestSHA256:'ec245a2b9fb53f21f1bd5616a3e37edab6cd9a32b86801f80a626659b3c30ef5'};
input.historicalArchiveLinks.unshift(input.original628dTerminalArchive.url);
input.limits=input.limits.map((x:string)=>x.includes('terminal archive link awaits')?'Original628d terminal failure evidence is published and independently audited; it remains NOT_ACCEPTED and is not repaired-head acceptance.':x);
input.reviews[0].report='/tmp/spn128-review-d22baa69-a.md';
input.reviews[0].originals=['/tmp/spn128-review-a-d22b-receipts.log','/tmp/spn128-review-a-d22b-probes.log','/tmp/spinel-dependabot-2026-11-11/spn128-review-a-d22b-receipts.json','/tmp/spinel-dependabot-2026-11-11/spn128-review-a-d22b-probes.json'];
const walk=(directory:string):string[]=>readdirSync(directory,{withFileTypes:true}).flatMap(e=>{if(e.isSymbolicLink()||e.name==='cache'||e.name==='node_modules')return [];const p=join(directory,e.name);return e.isDirectory()?walk(p):[p];});
input.reviews[0].originals.push(...walk('/tmp/spn128-review-a-d22b-probes'));
input.reviews[1].originals=['/tmp/spn128-review-b-controls-d22baa69.log','/tmp/spn128-review-b-portable-d22baa69.log','/tmp/spinel-dependabot-2026-11-11/spn128-review-b-controls-d22baa69.json','/tmp/spinel-dependabot-2026-11-11/spn128-review-b-portable-d22baa69.json','/tmp/spn128-review-b-provenance-d22baa69.json','/tmp/spn128-review-b-cleanup-d22baa69.json','/tmp/spn128-review-b-audit-d22baa69.json','/tmp/spn128-vitest.config.ts'];
writeFileSync(join(dir,'inputs.json'),JSON.stringify(input,null,2)+'\n');
