import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createGunzip} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const root='/Users/mxbaylee/projects/spinel-spn-146';
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(head,'02ef01a40fe8369b79477909673c76de6d2a4edf');
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'');
const timer=setTimeout(()=>{console.error('Evidence proof exceeded60seconds');process.exit(1);},60000);
const hash=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
async function digest(path:string,gzip=false){let bytes=0;const h=createHash('sha256');const input=createReadStream(path);const stream=gzip?input.pipe(createGunzip()):input;input.on('error',e=>stream.destroy(e));for await(const chunk of stream){bytes+=chunk.length;h.update(chunk);}return{bytes,sha256:h.digest('hex')};}
const groups:any[]=[];
for(const group of ['linux-runtime-outcome','qualification-reuse']){
 const dir=root+'/docs/implementation/evidence/SPN-146/'+group;
 const manifestBytes=await readFile(dir+'/manifest.json');const m=JSON.parse(manifestBytes.toString());
 assert.deepEqual((await readdir(dir)).sort(),['manifest.json',...m.payloads.map((p:any)=>p.name)].sort());
 const payloads=[];for(const p of m.payloads){const stored=await digest(dir+'/'+p.name),raw=await digest(dir+'/'+p.name,true);assert.deepEqual(stored,{bytes:p.storedBytes,sha256:p.storedSha256},p.name+'stored');assert.deepEqual(raw,{bytes:p.rawBytes,sha256:p.rawSha256},p.name+'raw');payloads.push({name:p.name,stored,raw});}
 for(const binding of m.sourceBindings??[])assert.equal(hash(await readFile(root+'/'+binding.path)),binding.sha256,binding.path);
 groups.push({group,manifestSha256:hash(manifestBytes),payloads,currentBindings:m.sourceBindings??[],source:m.source??m.sourceAtStart,storedBytes:payloads.reduce((s,p)=>s+p.stored.bytes,0),rawBytes:payloads.reduce((s,p)=>s+p.raw.bytes,0)});
}
const unchanged=['scripts/ci/doc-native-runtime/run.ts','scripts/ci/doc-native-runtime/watchdog.ts','scripts/ci/doc-native-runtime/convert.ts','src/ui/nativeDocFlushDiagnostic.ts','web/docResponsivenessEvidence.ts','e2e/doc-responsiveness.spec.ts'];
for(const p of unchanged)assert.equal(execFileSync('git',['diff','483bf8ae4609fa8027485293e6050fe8dca88e1c','HEAD','--',p],{cwd:root,encoding:'utf8'}),'',p);
const proof={head,groups,unchangedFromPublished:unchanged,passed:true};
await writeFile('/tmp/spn146-qualification-prepush-proof-a.json',JSON.stringify(proof,null,2)+'\n');clearTimeout(timer);
console.log(JSON.stringify({head,passed:true,groups:groups.map(g=>({group:g.group,payloads:g.payloads.length,storedBytes:g.storedBytes,rawBytes:g.rawBytes,bindings:g.currentBindings.length}))}));
