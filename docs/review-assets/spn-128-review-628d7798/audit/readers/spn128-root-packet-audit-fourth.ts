import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
const root='/tmp/spn128-review-packet-628d7798';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const read=(p:string)=>readFileSync(root+'/'+p);
const packet=JSON.parse(read('packet-manifest.json').toString());
const source=JSON.parse(read('source-manifest.json').toString());
assert.equal(hash(read('packet-manifest.json')),'412da891417cff6d99ca32c46bcb84e0fceb2eb36b0edb41f811c8585769a5f9');
for(const f of packet.files)assert.equal(hash(read(f.path)),f.sha256,f.path);
const git=(...args:string[])=>execFileSync('git',args,{cwd:'/Users/mxbaylee/projects/spinel',maxBuffer:64*1024*1024});
assert(git('diff','--binary','--full-index',packet.base,packet.head).equals(read('candidate.diff')));
let exact=0,ts=0,decoded=0;const masked:string[]=[];
for(const f of source.files){
 if(!f.source){assert(['candidate.diff','source-bindings.txt'].includes(f.path));assert.equal(hash(read(f.path)),f.originalSha256);assert.equal(f.originalSha256,f.copySha256);continue;}
 const stored=git('show',f.source+':'+f.sourcePath),copy=read(f.path);
 if(f.archiveSha256){assert.equal(hash(stored),f.archiveSha256);decoded++;}
 const blob=f.archiveSha256?gunzipSync(stored):stored;
 assert.equal(hash(blob),f.originalSha256,f.path);assert.equal(hash(copy),f.copySha256,f.path);
 if(f.blob)assert.equal(git('rev-parse',f.source+':'+f.sourcePath).toString().trim(),f.blob);
 if(f.masked){assert(f.path.endsWith('.md'));masked.push(f.path);}else{assert(blob.equals(copy),f.path);exact++;}
 if(/\.tsx?$/.test(f.path)){assert(!f.masked);ts++;}
}
const result={at:new Date().toISOString(),head:packet.head,base:packet.base,manifestSha256:hash(read('packet-manifest.json')),payloads:packet.files.length,sourceManifestEntries:source.files.length,actualGitSourceBindings:source.files.filter((f:any)=>f.source).length,exactSourceCopies:exact,exactTypeScriptCopies:ts,decodedGzipSources:decoded,maskedMarkdown:masked,fullBinaryDiffExact:true,readerCorrection:'Corrected three reader schema assumptions: compressed versus decoded hashes; optional historical blob IDs (actual Git commit/path bytes still checked); two derived diff/binding entries carry base/head rather than source/path. All original reader versions preserved. No packet/source changes.'};
writeFileSync('/tmp/spn128-root-packet-audit-628d7798.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
