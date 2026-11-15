/** GET-only collection of one explicitly superseded old-head body-edit run. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const runFile=promisify(execFile), root='/tmp/spn128-body-edit-43658181655';
const runId=43658181655, source='628d77987e7d9a08863465a7553a2ed82579728b',created='2026-11-15T00:26:34Z';
const stamp=new Date().toISOString().replaceAll(':','').replaceAll('.',''),snapshot=join(root,'snapshots',stamp);
mkdirSync(snapshot,{recursive:true});mkdirSync(join(root,'logs'),{recursive:true});mkdirSync(join(root,'artifacts'),{recursive:true});
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const requests:object[]=[];
async function get(endpoint:string,name:string,paginated=false){
 const args=['api','--method','GET',endpoint,...(paginated?['--paginate','--slurp']:[]),'--allow-escape-sequences'];
 try{const {stdout,stderr}=await runFile('gh',args,{encoding:'buffer',maxBuffer:64*1024*1024,timeout:45000});writeFileSync(join(snapshot,name+'.gz'),gzipSync(stdout));if(stderr.length)writeFileSync(join(snapshot,name+'.stderr'),stderr);requests.push({endpoint,file:name+'.gz',bytes:stdout.length,sha256:hash(stdout),status:'downloaded'});return stdout;}
 catch(error){const e=error as {stdout?:Buffer;stderr?:Buffer;code?:number;signal?:string;message?:string};const stdout=e.stdout??Buffer.alloc(0),stderr=e.stderr??Buffer.from(e.message??'Unknown request failure');writeFileSync(join(snapshot,name+'.unavailable-body.gz'),gzipSync(stdout));writeFileSync(join(snapshot,name+'.unavailable-stderr'),stderr);requests.push({endpoint,file:name+'.unavailable-body.gz',stderr:name+'.unavailable-stderr',code:e.code,signal:e.signal??null,status:'HTTP-or-request-unavailable',bodySha256:hash(stdout),stderrSha256:hash(stderr)});return null;}
}
const [runRaw,jobsRaw,artifactsRaw]=await Promise.all([
 get(`repos/mxbaylee/spinel/actions/runs/${runId}`,'run.json'),
 get(`repos/mxbaylee/spinel/actions/runs/${runId}/attempts/1/jobs?per_page=100`,'jobs-pages.json',true),
 get(`repos/mxbaylee/spinel/actions/runs/${runId}/artifacts?per_page=100`,'artifacts-pages.json',true),
]);
if(!runRaw||!jobsRaw||!artifactsRaw)throw Error('Inventory unavailable; original responses retained');
const run=JSON.parse(runRaw.toString()),jobs=JSON.parse(jobsRaw.toString()).flatMap((p:any)=>p.jobs),artifacts=JSON.parse(artifactsRaw.toString()).flatMap((p:any)=>p.artifacts);
if(run.id!==runId||run.head_sha!==source||run.created_at!==created||run.run_attempt!==1||run.event!=='pull_request')throw Error('Superseded run identity mismatch');
if(new Set(jobs.map((j:any)=>j.id)).size!==jobs.length||new Set(artifacts.map((a:any)=>a.id)).size!==artifacts.length)throw Error('Duplicate pagination result');
if(run.status==='completed'){
 for(const job of jobs){const dest=join(root,'logs',`job-${job.id}.log.gz`);if(existsSync(dest))continue;const raw=await get(`repos/mxbaylee/spinel/actions/jobs/${job.id}/logs`,`job-${job.id}.log`);if(raw)writeFileSync(dest,gzipSync(raw));}
 for(const artifact of artifacts){const dest=join(root,'artifacts',`artifact-${artifact.id}.zip`);if(existsSync(dest))continue;if(artifact.expired||artifact.size_in_bytes>64*1024*1024){requests.push({artifact:artifact.id,status:'not-downloaded',reason:artifact.expired?'expired':'exceeds bounded collector cap; coordinate streamed preservation'});continue;}const raw=await get(`repos/mxbaylee/spinel/actions/artifacts/${artifact.id}/zip`,`artifact-${artifact.id}.zip`);if(raw){if(raw.length!==artifact.size_in_bytes||artifact.digest&&artifact.digest!=='sha256:'+hash(raw))throw Error('Artifact integrity mismatch');writeFileSync(dest,raw,{flag:'wx'});}}
 const archive=await get(`repos/mxbaylee/spinel/actions/runs/${runId}/logs`,'run-logs.zip');if(archive)writeFileSync(join(root,'run-logs.zip'),archive,{flag:'wx'});
}
const summary={at:new Date().toISOString(),runId,source,created,attempt:1,status:run.status,conclusion:run.conclusion,event:run.event,updated:run.updated_at,terminal:run.status==='completed',snapshot,readOnly:true,role:'Superseded body-edit old-head cancellation preservation; NOT_ACCEPTED; not a repaired-head acceptance pass.',jobs:jobs.map((j:any)=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion,started:j.started_at,completed:j.completed_at,steps:j.steps})),artifacts,requests};
writeFileSync(join(snapshot,'collection.json'),JSON.stringify(summary,null,2)+'\n');writeFileSync(join(root,'latest.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({snapshot,terminal:summary.terminal,status:run.status,conclusion:run.conclusion,jobs:jobs.length,jobConclusions:jobs.reduce((a:any,j:any)=>(a[j.conclusion??j.status]=(a[j.conclusion??j.status]??0)+1,a),{}),artifacts:artifacts.length,unavailable:requests.filter((r:any)=>r.status!=='downloaded').length}));
