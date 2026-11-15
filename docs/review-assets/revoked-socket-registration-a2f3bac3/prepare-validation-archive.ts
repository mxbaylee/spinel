import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';import {join,dirname,relative} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';import assert from 'node:assert/strict';
const root='/Users/mxbaylee/projects/spinel-socket-closure-registration',out='/tmp/spinel-socket-closure-registration';
const source='a2f3bac37c084b8f9fbf163d562c96dae4aff8ef',base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d',review='6ce3cf31f64f2f1bcfc28976582a35415a56dbb8';
const prefix='docs/review-assets/revoked-socket-registration-a2f3bac3',tag='archive/revoked-socket-registration-validation-a2f3bac3-20261114';const stage=join(out,'validation-archive-stage'),payload=join(stage,prefix);
const git=(args:string[],options:{env?:NodeJS.ProcessEnv,input?:Buffer|string}={})=>execFileSync('git',args,{cwd:root,...options});
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]).sort();
assert.equal(git(['rev-parse','HEAD']).toString().trim(),source);assert.equal(git(['status','--porcelain=v1']).length,0);
if(process.argv[2]==='stage'){
 assert(!existsSync(stage));mkdirSync(payload,{recursive:true});const copied:any[]=[];
 const copy=(src:string,rel:string)=>{const b=readFileSync(src);const p=join(payload,rel);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,b,{flag:'wx'});copied.push({sourcePath:src,path:rel,bytes:b.length,sha256:hash(b)});};
 for(const p of files(join(out,'hosted')))copy(p,'hosted/'+relative(join(out,'hosted'),p));
 for(const n of ['hosted-audit.json','audit-hosted.ts','collect-hosted.ts','collect-missing-logs.ts','pr-created-293.json','pr-body-a2f3bac3-published-reviews.md','root-stage-audit.json','root-sealed-audit.json','draft-finding-dispositions.json','archive-helper-disposition.json','prepare-validation-archive.ts'])copy(join(out,n),n);
 for(const side of ['a','b'])copy(`/tmp/spn161-registration-review-${side}-a2f3bac3.md`,`reviews/reviewer-${side}.md`);
 for(const n of ['spn161-registration-root-packet-audit.json','spn161-registration-root-packet-audit.ts','spn161-registration-root-packet-audit-first.ts'])copy('/tmp/'+n,'manager/'+n);
 const reviewManifest=git(['show',`${review}:docs/review-assets/revoked-socket-registration-review-a2f3bac3/manifest.json`]);writeFileSync(join(payload,'published-review-manifest.json'),reviewManifest);
 writeFileSync(join(payload,'full.diff'),git(['diff','--full-index',base,source]));
 writeFileSync(join(payload,'copy-provenance.json'),JSON.stringify({source,base,reviewArchive:review,reviewManifestSha256:hash(reviewManifest),copies:copied},null,2)+'\n');
 writeFileSync(join(payload,'README.md'),readFileSync(join(out,'validation-archive-README.md')));
 const manifest=files(payload).map(p=>{const b=readFileSync(p);const entry:any={path:relative(payload,p),bytes:b.length,sha256:hash(b)};if(p.endsWith('.gz')){const decoded=gunzipSync(b);entry.decodedBytes=decoded.length;entry.decodedSha256=hash(decoded);}return entry;});
 writeFileSync(join(payload,'manifest.json'),JSON.stringify({source,base,reviewArchive:review,reservedTag:tag,payloads:manifest},null,2)+'\n');console.log(JSON.stringify({stage,prefix,payloads:manifest.length,addedPaths:manifest.length+1,decoded:manifest.filter(x=>x.decodedSha256).length}));
}else if(process.argv[2]==='seal'){
 assert.equal(process.argv[3],'root-authorized-local-seal');const m=JSON.parse(readFileSync(join(payload,'manifest.json'),'utf8'));assert.equal(files(payload).length,m.payloads.length+1);
 for(const e of m.payloads){const b=readFileSync(join(payload,e.path));assert.equal(b.length,e.bytes);assert.equal(hash(b),e.sha256);if(e.decodedSha256){const decoded=gunzipSync(b);assert.equal(decoded.length,e.decodedBytes);assert.equal(hash(decoded),e.decodedSha256);}}
 const index=join(out,'validation-private-index');assert(!existsSync(index));const env={...process.env,GIT_INDEX_FILE:index};git(['read-tree',source],{env});
 for(const p of files(payload)){const blob=git(['hash-object','-w','--stdin'],{input:readFileSync(p)}).toString().trim();git(['update-index','--add','--cacheinfo',`100644,${blob},${relative(stage,p)}`],{env});}
 const tree=git(['write-tree'],{env}).toString().trim();const commit=git(['commit-tree',tree,'-p',source],{input:'Preserve PR 293 original registration validation evidence\n'}).toString().trim();const paths=git(['diff','--name-status',source,commit]).toString().trim().split('\n');assert(paths.every(p=>p.startsWith('A\t'+prefix+'/')));assert.equal(git(['rev-parse','HEAD']).toString().trim(),source);assert.equal(git(['status','--porcelain=v1']).length,0);
 const result={commit,parent:source,tree,prefix,reservedTag:tag,addedPaths:paths.length,payloads:m.payloads.length,decoded:m.payloads.filter((e:any)=>e.decodedSha256).length,published:false};writeFileSync(join(out,'validation-archive-identity.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}else throw Error('stage or explicitly authorized seal only');
