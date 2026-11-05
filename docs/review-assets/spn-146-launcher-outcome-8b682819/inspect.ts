import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='/tmp/spn146-launcher-outcome';
const zip=root+'/observation.zip';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const raw=readFileSync(zip);
assert.equal(raw.length,11376066); assert.equal(sha(raw),'f0f4987040a6825f2dde6e1cb31e12ec3b8b15c66db0979b5baeb9dc83537edc');
const crc=execFileSync('unzip',['-t',zip],{encoding:'utf8',maxBuffer:1024*1024}); assert.ok(crc.includes('No errors detected'));
const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n'); assert.equal(names.length,70);
mkdirSync(root+'/inspection',{recursive:true});
const members=names.map(name=>{
 assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));
 const b=execFileSync('unzip',['-p',zip,name],{maxBuffer:24*1024*1024});
 if(name.endsWith('.json') || name.endsWith('.cpuprofile')) {assert.ok(b.length<8*1024*1024);writeFileSync(root+'/inspection/'+name.split('/').at(-1),b);}
 return {name,bytes:b.length,sha256:sha(b)};
});
const binding=JSON.parse(readFileSync(root+'/inspection/binding.json','utf8'));
assert.equal(binding.complete,true);
const native='node_modules/@univerjs/docs/lib/es/index.js',core='node_modules/@univerjs/core/lib/es/index.js';
assert.equal(binding.bindings[native],'57ec2ee153792c73e466a753d2e5c9ed1cd19615bb45a04fbe72c9336a6ad2b8');
assert.equal(binding.bindings[core],'a019e7eb8b2ba235c7cfd54a19c262377a90c25aca13e5c2e0671a43b709e434');
let bytes=0;
for(const row of binding.scripts){
 for(const [path,size,digest] of [[row.path,row.bytes,row.sha256],...(row.mapStatus==='present'?[[row.path+'.map',row.mapBytes,row.mapSha256]]:[])]) {
 const matched=members.filter(m=>m.name.endsWith('/spn146-loaded-sources/'+path));assert.equal(matched.length,1);assert.equal(matched[0]!.bytes,size);assert.equal(matched[0]!.sha256,digest); bytes+=Number(size);
 }
 if(row.mapStatus==='absent-at-collection'){assert.equal(row.mapBytes,null);assert.equal(row.mapSha256,null);assert.deepEqual(row.mapped,{});}
}
assert.equal(bytes,binding.bytes);
writeFileSync(root+'/integrity.json',JSON.stringify({zip:{bytes:raw.length,sha256:sha(raw)},crc:true,members,binding:{scripts:binding.scripts.length,bytes,bindings:binding.bindings,unmapped:binding.scripts.filter((r:any)=>r.mapStatus==='absent-at-collection').map((r:any)=>r.path)},limitation:'Map bytes hashed but not parsed; no new trace or converter execution.'},null,2)+'\n');
console.log(JSON.stringify({members:members.length,bindingScripts:binding.scripts.length,bytes,crc:true}));
