import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
const expected=process.argv[2];
const repo='/Users/mxbaylee/projects/spinel-spn-146',root='/tmp/spn146-source-probe/run';
// A replay guard fails before touching any previous attempt's receipt.
await mkdir(root);
const record:any={source:expected,baselineSource:'df76fb78fa0258f8c28c068767970e8e869a5838',order:['baseline','prepare','revised'],criterion:'Exact complete output parity and live maxRSS reduction >=64MiB AND >=10%; no latency/browser-cause claim',complete:false,phase:'preflight'};
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
let primary:unknown;
try{
 await writeFile(root+'/result.json',JSON.stringify(record,null,2));
 assert.match(expected??'',/^[a-f0-9]{40}$/);
 const git=(args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 assert.equal(git(['rev-parse','HEAD']),expected);assert.equal(git(['status','--porcelain']),'');
 await mkdir(root+'/input');
 const zip='/tmp/spn146-map-repair-outcome/observation.zip',raw=await readFile(zip);assert.equal(raw.length,10577071);assert.equal(hash(raw),'842d8f268885870966010855aa8e2ec0a2e11532e2e3d8b133c54ee64663682a');
 const proof=JSON.parse(await readFile('/tmp/spn146-map-repair-outcome/integrity-b.json','utf8'));
 record.phase='extract';
 for(const row of proof.members){const marker='/spn146-loaded-sources/',at=row.name.indexOf(marker);if(at<0)continue;const path=row.name.slice(at+marker.length);assert.ok(!path.startsWith('/')&&!path.split('/').includes('..'));
  const bytes=execFileSync('unzip',['-p',zip,row.name],{maxBuffer:24*1024**2});assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);await mkdir(dirname(root+'/input/'+path),{recursive:true});await writeFile(root+'/input/'+path,bytes);
 }
 const baseline=execFileSync('git',['show','df76fb78fa0258f8c28c068767970e8e869a5838:e2e/doc-responsiveness-native-sources.ts'],{cwd:repo});await writeFile(root+'/baseline.ts',baseline);
 Object.assign(record,{baselineCollectorSha256:hash(baseline),probeSha256:hash(await readFile('/tmp/spn146-source-probe/run.ts')),childSha256:hash(await readFile('/tmp/spn146-source-probe/child.ts'))});
 for(const mode of record.order){record.phase=mode;await writeFile(root+'/result.json',JSON.stringify(record,null,2));const child=spawnSync(process.execPath,['/tmp/spn146-source-probe/child.ts',mode,root],{encoding:'utf8',timeout:60000,maxBuffer:1024**2});
  let childError:unknown;
  if(child.error||child.status!==0||child.signal){record.childFailure={mode,status:child.status,signal:child.signal,error:String(child.error??child.stderr)};childError=new Error(`${mode} child failed`);}
  try{await writeFile(root+'/'+mode+'.log',(child.stdout??'')+(child.stderr??''));}catch(error){(record.secondaryErrors??=[]).push({phase:mode+'-log',error:String(error)});childError??=error;}
  if(childError)throw childError;
 }
 record.phase='parity';
 const input=JSON.parse(await readFile(root+'/input/binding.json','utf8'));
 const verified=[];
 for(const row of input.scripts)for(const [path,digest] of [[row.path,row.sha256],...(row.mapStatus==='present'?[[row.path+'.map',row.mapSha256]]:[])]){for(const mode of ['baseline','revised']) assert.equal(hash(await readFile(root+'/'+mode+'/'+path)),digest);verified.push({path,sha256:digest});}
 const samples=await Promise.all(record.order.map(async(mode:string)=>JSON.parse(await readFile(root+'/'+mode+'-resource.json','utf8'))));
 assert.deepEqual(samples[0].commands,samples[2].commands);assert.ok(samples.every(row=>row.complete&&row.maxRSSKiB>0));
 const reductionKiB=samples[0].maxRSSKiB-samples[2].maxRSSKiB,reductionFraction=reductionKiB/samples[0].maxRSSKiB;
 Object.assign(record,{samples,verified,reductionKiB,reductionFraction,qualified:reductionKiB>=64*1024&&reductionFraction>=.1,complete:true,phase:'settled'});
 if(!record.qualified)process.exitCode=1;
} catch(error){primary=error;record.error=String(error);record.complete=false;}
finally{try{await writeFile(root+'/result.json',JSON.stringify(record,null,2));}catch(error){console.error('Secondary result receipt failure',String(error));primary??=error;}console.log(JSON.stringify({complete:record.complete,qualified:record.qualified,reductionKiB:record.reductionKiB,reductionFraction:record.reductionFraction,error:record.error}));}
if(primary)throw primary;
