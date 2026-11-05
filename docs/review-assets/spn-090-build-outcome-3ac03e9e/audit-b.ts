import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='/tmp/spn090-build-outcome', zip=root+'/build.zip';
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const raw=readFileSync(zip);assert.equal(raw.length,3579896);assert.equal(sha(raw),'01ebb0d88d6f4c664fd8218bb46c7da29a4aac250863db5d105559890b4fa5d0');
assert.match(execFileSync('unzip',['-t',zip],{encoding:'utf8'}),/No errors detected/);
const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
const members=names.map(name=>{assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));const b=execFileSync('unzip',['-p',zip,name],{maxBuffer:20*1024*1024});return {name,bytes:b.length,sha256:sha(b)};});
const member=(ending:string)=>{const n=names.filter(n=>n.endsWith(ending));assert.equal(n.length,1);return execFileSync('unzip',['-p',zip,n[0]],{maxBuffer:4*1024*1024});};
const graph=JSON.parse(member('browserstack-build-graph.json').toString()), result=JSON.parse(member('browserstack-build-result.json').toString()), identity=JSON.parse(member('browserstack-build-identity.json').toString());
assert.deepEqual(graph,JSON.parse(readFileSync(root+'/graph.json','utf8')));assert.deepEqual(result,JSON.parse(readFileSync(root+'/result.json','utf8')));
assert.equal(result.complete,true);assert.equal(graph.complete,true);assert.equal(result.phase,'settled');
for(const r of [graph,result,identity]){assert.equal(r.source,'3ac03e9ecf48798aa4942aba1f1ab0fb4650c09b');assert.equal(r.runId,'42060405449');assert.equal(r.attempt,'1');assert.equal(r.tree,'9c4810ecdf88434917c278b94a0efc2587081c05');}
for(const [path,h] of Object.entries(graph.sourceHashes)){assert.equal(sha(execFileSync('git',['show',graph.source+':'+path])),h);}
for(const row of graph.finalFiles){const m=members.find(m=>m.name==='dist/'+row.file);assert.ok(m);assert.equal(m.bytes,row.bytes);assert.equal(m.sha256,row.sha256);}
assert.equal(members.filter(m=>m.name.startsWith('dist/')).length,graph.finalFiles.length);
const files=new Map<string,any>(graph.files.map((f:any)=>[f.file,f]));const closure=new Set<string>();
const visit=(f:string)=>{if(closure.has(f))return;closure.add(f);assert.equal(files.get(f).type,'chunk');for(const e of files.get(f).imports)visit(e);};visit(graph.applicationEntry);assert.deepEqual([...closure].sort(),graph.staticJavaScriptClosure);
assert.equal([...closure].reduce((n,f)=>n+files.get(f).bytes,0),graph.staticBytes);
const initial=[...closure].map(f=>files.get(f)).sort((a,b)=>b.bytes-a.bytes);
const proof={source:graph.source,tree:graph.tree,runId:graph.runId,attempt:1,zip:{bytes:raw.length,sha256:sha(raw)},crc:true,members,finalFiles:graph.finalFiles.length,staticBytes:graph.staticBytes,staticGzipBytes:graph.staticGzipBytes,staticChunks:initial.map(f=>({file:f.file,bytes:f.bytes,gzipBytes:f.gzipBytes,imports:f.imports,modules:f.modules.slice().sort((a:any,b:any)=>b.renderedLength-a.renderedLength).slice(0,14)})),css:graph.preRenderStylesheets.map((f:string)=>files.get(f.slice(1))),htmlEntrypoints:graph.htmlEntrypoints};
writeFileSync(root+'/proof-b.json',JSON.stringify(proof,null,2)+'\n');writeFileSync(root+'/identity-b.json',JSON.stringify(identity,null,2)+'\n');console.log(JSON.stringify({members:members.length,files:graph.finalFiles.length,staticChunks:closure.size,staticBytes:graph.staticBytes,staticGzipBytes:graph.staticGzipBytes}));
