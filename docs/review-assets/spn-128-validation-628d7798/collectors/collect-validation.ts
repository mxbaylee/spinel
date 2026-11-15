// Prepared GET-only snapshot collector, adapted from SPN123 f232 bounded collector.
// Do not execute before root confirms source push and assigns exact current-head run IDs.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const runFile=promisify(execFile),source='628d77987e7d9a08863465a7553a2ed82579728b',base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d';
const root='/tmp/spn128-publication-628d7798/validation';
const configuration=JSON.parse(readFileSync(process.argv[2]??'/tmp/spn128-publication-628d7798/collector-input.json','utf8'));
if(configuration.publicationConfirmed!==true||configuration.source!==source||configuration.base!==base||!Array.isArray(configuration.runs)||!configuration.runs.length||configuration.runs.some((r:any)=>!/^\d+$/.test(String(r.id))||!['ci','storybook','desktop','spaces'].includes(r.kind)))throw Error('Await root source-push confirmation and exact run identities');
const stamp=new Date().toISOString().replaceAll(':','').replaceAll('.','');
const snapshot=join(root,'snapshots',stamp),logs=join(root,'logs'),zips=join(root,'original-zips');
for(const path of [snapshot,logs,zips])mkdirSync(path,{recursive:true});
const files:any[]=[],errors:any[]=[],workflows:any[]=[];
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function save(path:string,raw:Buffer){const b=gzipSync(raw);writeFileSync(path+'.gz',b,{flag:'wx'});files.push({path:path+'.gz',bytes:b.length,sha256:hash(b),rawBytes:raw.length,rawSha256:hash(raw)});}
async function request(endpoint:string,paginated=false){return (await runFile('gh',['api','--method','GET',endpoint,...(paginated?['--paginate','--slurp']:[]),'--allow-escape-sequences'],{encoding:'buffer',maxBuffer:64*1024*1024,timeout:45000})).stdout;}
async function json(endpoint:string,name:string,paginated=false){const raw=await request(endpoint,paginated);save(join(snapshot,name+'.json'),raw);return JSON.parse(raw.toString());}
try{
 const [pr,commit]=await Promise.all([json('repos/mxbaylee/spinel/pulls/229','pr'),json('repos/mxbaylee/spinel/commits/'+source,'source-commit'),json('repos/mxbaylee/spinel/actions/runs?head_sha='+source+'&per_page=100','all-source-runs',true),json('repos/mxbaylee/spinel/commits/'+source+'/check-runs?per_page=100','check-runs',true)]);
 if(pr.head.sha!==source)throw Error('Remote head changed');
 if(pr.base.sha!==base)throw Error('Observed PR base differs; preserve snapshot and coordinate actual-main/tested-merge identity before acceptance');
 save(join(snapshot,'observed-pr-body.md'),Buffer.from(pr.body??''));
 if(pr.merge_commit_sha)await json('repos/mxbaylee/spinel/commits/'+pr.merge_commit_sha,'observed-merge-commit');
 for(const {kind,id} of configuration.runs){
  const [run,jp,ap]=await Promise.all([json(`repos/mxbaylee/spinel/actions/runs/${id}`,`run-${kind}`),json(`repos/mxbaylee/spinel/actions/runs/${id}/attempts/1/jobs?per_page=100`,`jobs-${kind}-attempt-1`,true),json(`repos/mxbaylee/spinel/actions/runs/${id}/artifacts?per_page=100`,`artifacts-${kind}`,true)]);
  if(run.head_sha!==source||run.run_attempt!==1||run.event!=='pull_request')throw Error('Run source/attempt/event mismatch '+id);
  const jobs=jp.flatMap((p:any)=>p.jobs),artifacts=ap.flatMap((p:any)=>p.artifacts);
  if(new Set(jobs.map((j:any)=>j.id)).size!==jobs.length)throw Error('Duplicate jobs');
  workflows.push({kind,id,attempt:1,source,status:run.status,conclusion:run.conclusion,jobs:jobs.map((j:any)=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion})),artifacts});
  for(const job of jobs.filter((j:any)=>j.status==='completed'&&j.conclusion!=='skipped')){
   const path=join(logs,`job-${job.id}.log`);if(existsSync(path+'.gz'))continue;
   try{save(path,await request(`repos/mxbaylee/spinel/actions/jobs/${job.id}/logs`));}catch(e){errors.push({job:job.id,error:String(e)});}
  }
  for(const a of artifacts.filter((a:any)=>a.name==='ci-plan'||a.name.startsWith('ci-results-')||a.name==='spaces-acceptance'||a.name==='sized-restore-acceptance')){
   const path=join(zips,`artifact-${a.id}.zip`);if(existsSync(path))continue;
   try{if(a.expired)throw Error('Expired artifact; required evidence unavailable');if(a.size_in_bytes>32*1024*1024)throw Error('Artifact exceeds bounded snapshot download; preserve inventory for separate streamed collection');const b=await request(`repos/mxbaylee/spinel/actions/artifacts/${a.id}/zip`);writeFileSync(path,b,{flag:'wx'});if(a.size_in_bytes!==b.length||a.digest&&a.digest!=='sha256:'+hash(b))throw Error('Artifact size/digest mismatch');files.push({path,bytes:b.length,sha256:hash(b),artifact:a});}catch(e){errors.push({artifact:a.id,error:String(e)});}
  }
 }
}catch(e){errors.push({error:String(e)});}finally{
 const result={at:new Date().toISOString(),source,base,snapshot,readOnly:true,workflows,errors,files,allTerminal:workflows.length===configuration.runs.length&&workflows.every(r=>r.status==='completed'),note:'First attempt only. No rerun/cancel/dispatch/metadata/source mutation. Originala6dd and earlier attempts remain historical failed/cancelled validation; published prior reviews retain setup/preflight/resource outcomes. Main SPN123CI is separately useful, not current628d acceptance. Do not infer no configured retry from job success. Logs/artifacts retained locally until privacy review and immutable evidence staging. Snapshot download cap does not waive missing evidence.'};
 writeFileSync(join(snapshot,'collection.json'),JSON.stringify(result,null,2)+'\n');writeFileSync(join(root,'latest.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({snapshot,workflows:workflows.map(r=>({kind:r.kind,status:r.status,conclusion:r.conclusion,jobs:r.jobs.length,failed:r.jobs.filter((j:any)=>j.conclusion==='failure').map((j:any)=>({id:j.id,name:j.name})),completed:r.jobs.filter((j:any)=>j.status==='completed').length,artifacts:r.artifacts.length})),errors,files:files.length,allTerminal:result.allTerminal}));
}
