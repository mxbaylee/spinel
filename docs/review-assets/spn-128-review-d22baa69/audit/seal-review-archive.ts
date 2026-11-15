/** Seal prepared evidence with a private index; leave implementation and all refs unchanged. */
import {readFileSync,writeFileSync,copyFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const cwd='/Users/mxbaylee/projects/spinel-spn-128-production',staging='/tmp/spn128-preservation-d22baa69',root=join(staging,'archive');
const source='d22baa6997e27c123ef351a8f5321089cc9e345b',base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d',prefix='docs/review-assets/spn-128-review-d22baa69';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const normal=(args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:20*1024*1024}).trim();
if(normal(['rev-parse','HEAD'])!==source||normal(['status','--porcelain']))throw Error('Candidate changed');
const refsBefore=normal(['show-ref']);
const walk=(dir:string):string[]=>readdirSync(dir).flatMap(n=>{const p=join(dir,n),s=lstatSync(p);if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))throw Error('Unsupported archive member');return s.isDirectory()?walk(p):[p];});
const previous=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
for(const e of previous.files){if(hash(readFileSync(join(root,e.path)))!==e.sha256)throw Error('Staged payload changed '+e.path);}
copyFileSync(join(staging,'seal-review-archive.ts'),join(root,'audit/seal-review-archive.ts'));
copyFileSync(join(staging,'stage.log'),join(root,'audit/stage.log'));
const payload=walk(root).filter(p=>p!==join(root,'manifest.json')).sort().map(p=>({path:p.slice(root.length+1),bytes:lstatSync(p).size,sha256:hash(readFileSync(p))}));
writeFileSync(join(root,'manifest.json'),JSON.stringify({source,base,files:payload},null,2)+'\n');
const index=join(staging,'archive.index');if(existsSync(index))throw Error('Private index already exists');
const env={...process.env,GIT_INDEX_FILE:index};
const git=(args:string[],input?:Buffer)=>execFileSync('git',args,{cwd,env,input,encoding:'utf8',maxBuffer:100*1024*1024}).trim();
git(['read-tree',source]);
for(const p of walk(root).sort()){const blob=git(['hash-object','-w','--stdin'],readFileSync(p));git(['update-index','--add','--cacheinfo',`100644,${blob},${prefix}/${p.slice(root.length+1)}`]);}
const tree=git(['write-tree']);
const commit=git(['commit-tree',tree,'-p',source,'-m','🌷 SPN-128 Preserve repaired exact-head independent review evidence']);
const paths=normal(['diff','--name-only',source,commit]).split('\n');
if(paths.length!==payload.length+1||paths.some(p=>!p.startsWith(prefix+'/')))throw Error('Archive path isolation');
if(normal(['rev-parse',commit+'^'])!==source||normal(['rev-list','--parents','-n','1',commit]).split(' ').length!==2)throw Error('Archive direct parent mismatch');
for(const e of [...payload,{path:'manifest.json',sha256:hash(readFileSync(join(root,'manifest.json')))}]){
 const stored=execFileSync('git',['show',commit+':'+prefix+'/'+e.path],{cwd,maxBuffer:100*1024*1024});if(hash(stored)!==e.sha256)throw Error('Sealed payload mismatch '+e.path);
}
if(normal(['rev-parse','HEAD'])!==source||normal(['status','--porcelain'])||normal(['show-ref'])!==refsBefore)throw Error('Candidate or refs changed');
const receipt={commit,parent:source,base,tree,prefix,totalFiles:paths.length,payloads:payload.length,originalCopies:JSON.parse(readFileSync(join(root,'provenance.json'),'utf8')).originals.length,manifestSha256:hash(readFileSync(join(root,'manifest.json'))),packetArchive:JSON.parse(readFileSync(join(root,'packet-archive-verification.json'),'utf8')),allSealedGitBytesVerified:true,allRefsUnchanged:true,status:'Unreferenced local evidence commit; root independent audit and tag/publication pending'};
writeFileSync(join(staging,'seal.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
