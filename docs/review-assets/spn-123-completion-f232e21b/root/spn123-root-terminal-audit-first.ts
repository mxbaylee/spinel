import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root='/tmp/spn123-terminal-f232e21b/archive';
const commit=process.argv[2];
assert.match(commit,/^[a-f0-9]{40}$/);
const source='f232e21b4910afe6209a22d8d78516c598eba1a5';
const git=(...args:string[])=>execFileSync('git',args,{cwd:'/Users/mxbaylee/projects/spinel',maxBuffer:64*1024*1024});
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const manifest=json(root+'/manifest.json');
assert.equal(manifest.parent,source);assert.equal(manifest.source,source);
assert.equal(git('show','-s','--format=%P',commit).toString().trim(),source);
const diff=git('diff-tree','--no-commit-id','--name-status','-r',commit).toString().trim().split('\n');
assert.equal(diff.length,manifest.files.length+1);
for(const row of diff)assert(row.startsWith('A\t'+manifest.prefix+'/'));
let gz=0;
for(const f of [...manifest.files,{path:'manifest.json',bytes:readFileSync(root+'/manifest.json').length,sha256:sha(readFileSync(root+'/manifest.json'))}]){
 const b=readFileSync(root+'/'+f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256,f.path);
 assert(git('show',commit+':'+manifest.prefix+'/'+f.path).equals(b),f.path);
 if(f.path.endsWith('.gz')){gunzipSync(b);gz++;}
}
let originalBindings=0;
for(const f of json(root+'/collection-bindings.json')){
 const b=readFileSync(root+'/'+f.path);assert.equal(sha(b),f.retainedSha256);
 const raw=f.encoding.includes('gzip')?gunzipSync(b):b;
 assert.equal(raw.length,f.bytes);assert.equal(sha(raw),f.sha256);assert(raw.equals(readFileSync(f.original)),f.original);originalBindings++;
}
let zipCount=0,memberCount=0,retained=0;
for(const z of json(root+'/artifact-inventory.json')){
 let bytes=0;const hash=createHash('sha256');
 for await(const b of createReadStream(z.privateOriginalPath)){bytes+=b.length;hash.update(b);}
 assert.equal(bytes,z.bytes);assert.equal(hash.digest('hex'),z.sha256);assert.equal(z.apiDigest,'sha256:'+z.sha256);assert(z.crcVerified);zipCount++;
 for(const m of z.members){memberCount++;if(!m.retainedPath)continue;
  const b=readFileSync(root+'/'+m.retainedPath);const raw=m.retainedPath.endsWith('.gz')?gunzipSync(b):b;
  assert.equal(raw.length,m.bytes,m.name);assert.equal(sha(raw),m.sha256,m.name);retained++;
 }
}
const audit={at:new Date().toISOString(),archive:commit,parent:source,exclusiveAdditions:diff.length,payloads:manifest.files.length,actualGzipDecoded:gz,allStoredHashesAndGitBlobsVerified:true,originalCollectionBindings:originalBindings,originalZipHashesVerified:zipCount,inventoriedMembers:memberCount,retainedOriginalMemberBindings:retained,crcSource:'Independent collector streaming CRC; root independently verifies whole ZIP hashes and retained member bytes, without repeating derived trace extraction.',manifestSHA256:sha(readFileSync(root+'/manifest.json'))};
writeFileSync('/tmp/spn123-root-terminal-audit-f232e21b.json',JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
