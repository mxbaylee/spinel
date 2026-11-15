import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto'; import {execFileSync} from 'node:child_process'; import assert from 'node:assert/strict'; import {gunzipSync} from 'node:zlib';
const root='/tmp/spn128-review-packet-d22baa69',temp=mkdtempSync('/tmp/spn128-root-packet-zips-');
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex'),read=(p:string)=>readFileSync(root+'/'+p),git=(...args:string[])=>execFileSync('git',args,{cwd:'/Users/mxbaylee/projects/spinel',maxBuffer:64*1024*1024});
const manifest=JSON.parse(read('source-manifest.json').toString());assert.equal(hash(read('source-manifest.json')),'3f105b060350c736406c9b69ffc8cb998d96319c47de2ef4368f2041fc3221d2');
assert(git('diff','--binary','--full-index',manifest.base,manifest.head).equals(read('candidate.diff')));
let exact=0,ts=0,gzip=0,zipMembers=0;const masked:string[]=[];
for(const f of manifest.files){ const copy=read(f.path);assert.equal(hash(copy),f.copySha256,f.path); if(!f.sourcePath){assert.equal(f.originalSha256,f.copySha256);continue;}
 const stored=git('show',f.source+':'+f.sourcePath);let original=stored;
 if(f.archiveSha256){assert.equal(hash(stored),f.archiveSha256);if(f.member){const p=temp+'/'+f.archiveSha256+'.zip';writeFileSync(p,stored);original=execFileSync('unzip',['-p',p,f.member],{maxBuffer:32*1024*1024});zipMembers++;}else{original=gunzipSync(stored);gzip++;}}
 assert.equal(hash(original),f.originalSha256,f.path);if(f.blob)assert.equal(git('rev-parse',f.source+':'+f.sourcePath).toString().trim(),f.blob);
 if(f.masked){assert(f.path.endsWith('.md'));masked.push(f.path);}else{assert(original.equals(copy),f.path);exact++;}if(/\.tsx?$/.test(f.path)){assert(!f.masked);ts++;}
}
for(const f of manifest.omitted){const stored=git('show',manifest.head+':'+f.path);assert.equal(stored.length,f.size);assert.equal(hash(stored),f.sha256);assert.equal(git('rev-parse',manifest.head+':'+f.path).toString().trim(),f.blob);}
const changed=git('diff','--name-only','524dca9ed0679716a3db6a16b4d78c58f07b58a7',manifest.head).toString().trim().split('\n');assert(changed.every(p=>p.startsWith('docs/')));
const result={at:new Date().toISOString(),head:manifest.head,base:manifest.base,manifestSha256:hash(read('source-manifest.json')),payloads:manifest.files.length,actualGitSourceBindings:manifest.files.filter((f:any)=>f.sourcePath).length,exactSourceCopies:exact,exactTypeScriptCopies:ts,decodedGzipSources:gzip,decodedZipMembers:zipMembers,maskedMarkdown:masked,maskedLines:manifest.masks.length,inventoriedOmissionsVerified:manifest.omitted.length,fullBinaryDiffExact:true,postTest524dChangesOnlyDocs:true,readerCorrection:'Initial reader assumed prior packet README/packet-manifest filenames; ENOENT before mutation. This packet uses review-input.md and source-manifest.json. No packet/source change.'};writeFileSync('/tmp/spn128-root-packet-audit-d22baa69.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
