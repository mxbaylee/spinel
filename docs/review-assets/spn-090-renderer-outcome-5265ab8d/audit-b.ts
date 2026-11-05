import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='/tmp/spn090-renderer-outcome',zip=root+'/build.zip',source='5265ab8d26c7c607bef189a1fd720f8bd28d6584';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const raw=readFileSync(zip);assert.equal(raw.length,3652178);assert.equal(sha(raw),'7e0e2b9c4a3c26f7e81b47dfcad7737e1cef349f2ca04ba30ce827d053b7ae61');
assert.match(execFileSync('unzip',['-t',zip],{encoding:'utf8'}),/No errors detected/);
const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
const members=names.map(name=>{assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));const b=execFileSync('unzip',['-p',zip,name],{maxBuffer:20*1024*1024});return {name,bytes:b.length,sha256:sha(b)};});
const json=(suffix:string)=>{const n=names.filter(n=>n.endsWith(suffix));assert.equal(n.length,1);return JSON.parse(execFileSync('unzip',['-p',zip,n[0]],{maxBuffer:4*1024*1024}).toString());};
const graph=json('browserstack-build-graph.json'),result=json('browserstack-build-result.json'),identity=json('browserstack-build-identity.json');
assert.deepEqual(graph,JSON.parse(readFileSync(root+'/graph.json','utf8')));assert.deepEqual(result,JSON.parse(readFileSync(root+'/result.json','utf8')));
for(const r of [graph,result,identity]){assert.equal(r.source,source);assert.equal(r.runId,'42063895317');assert.equal(r.attempt,'1');assert.equal(r.tree,execFileSync('git',['rev-parse',source+'^{tree}'],{encoding:'utf8'}).trim());}
assert.equal(graph.complete,true);assert.equal(result.complete,true);assert.equal(result.phase,'settled');assert.equal(graph.rendererBoundary.passed,true);
for(const [path,h] of Object.entries(graph.sourceHashes))assert.equal(sha(execFileSync('git',['show',source+':'+path])),h);
for(const row of graph.finalFiles){const m=members.find(m=>m.name==='dist/'+row.file);assert.ok(m);assert.equal(m.bytes,row.bytes);assert.equal(m.sha256,row.sha256);}assert.equal(graph.finalFiles.length,members.filter(m=>m.name.startsWith('dist/')).length);
const chunks=new Map<string,any>(graph.files.filter((f:any)=>f.type==='chunk').map((f:any)=>[f.file,f]));
function closure(roots:string[],dynamic=false){const s=new Set<string>();const visit=(f:string)=>{if(s.has(f))return;s.add(f);const row=chunks.get(f);assert.ok(row);for(const edge of [...row.imports,...(dynamic?row.dynamicImports:[])])visit(edge);};roots.forEach(visit);return s;}
const initial=closure([graph.applicationEntry]);assert.deepEqual([...initial].sort(),graph.staticJavaScriptClosure);assert.equal([...initial].reduce((n,f)=>n+chunks.get(f).bytes,0),graph.staticBytes);
const renderers=[...chunks.values()].filter(f=>f.modules.some((m:any)=>m.id.includes('node_modules/@univerjs/engine-render/')));
const modules=[...new Set<string>(renderers.flatMap(f=>f.modules.map((m:any)=>m.id).filter((id:string)=>id.includes('node_modules/@univerjs/engine-render/'))))].sort();
const baseline=JSON.parse(execFileSync('git',['show',source+':docs/implementation/evidence/SPN-090/renderer-baseline.json']).toString());assert.deepEqual(modules,baseline.modules);assert.equal(modules.length,78);assert.equal(sha(readFileSync('/tmp/spn090-build-outcome/graph.json')),baseline.graphSha256);
for(const r of renderers){assert.ok(!initial.has(r.file));assert.ok(graph.descriptor.files.includes('/'+r.file));}
const editors:any={};for(const id of ['web/DocEditor.tsx','web/SheetEditor.tsx']){const roots=[...chunks.values()].filter(f=>f.modules.some((m:any)=>m.id===id)).map(f=>f.file);assert.ok(roots.length);const s=closure(roots,true);for(const r of renderers)assert.ok(s.has(r.file));assert.deepEqual([...s].sort(),graph.rendererBoundary.editors[id]);editors[id]=roots;}
const previous=JSON.parse(readFileSync('/tmp/spn090-build-outcome/graph.json','utf8'));
const css=graph.preRenderStylesheets.map((p:string)=>graph.files.find((r:any)=>r.file===p.slice(1)));const cssBytes=css.reduce((n:number,r:any)=>n+r.bytes,0);assert.equal(cssBytes,325951);for(const c of css){const old=previous.files.find((r:any)=>r.file===c.file);assert.ok(old);assert.equal(c.sha256,old.sha256);}
const proof={source,tree:graph.tree,runId:graph.runId,attempt:1,zip:{bytes:raw.length,sha256:sha(raw)},members,criterionPassed:true,rendererModules:modules,rendererChunks:renderers.map(f=>({file:f.file,bytes:f.bytes,gzipBytes:f.gzipBytes})),editors,initial:{chunks:initial.size,bytes:graph.staticBytes,gzipBytes:graph.staticGzipBytes},previous:{bytes:previous.staticBytes,gzipBytes:previous.staticGzipBytes},css:{count:css.length,bytes:cssBytes,unchangedBytes:true},initialLargest:[...initial].map(f=>chunks.get(f)).sort((a,b)=>b.bytes-a.bytes).slice(0,8).map(f=>({file:f.file,bytes:f.bytes,gzipBytes:f.gzipBytes,top:f.modules.slice().sort((a:any,b:any)=>b.renderedLength-a.renderedLength).slice(0,3)}))};
writeFileSync(root+'/proof-b.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({members:members.length,finalFiles:graph.finalFiles.length,rendererModules:modules.length,initial:proof.initial,css:proof.css}));
