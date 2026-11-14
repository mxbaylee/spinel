// Task-local GET-only bounded resumption. Does not restart or mutate product jobs.
// Uses verified original ZIPs; preserves the interrupted collector and partial files.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,createReadStream,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const root='/tmp/spn098-publication-7a045191/hosted';
const dir=join(root,'terminal-collected');mkdirSync(dir);mkdirSync(join(dir,'original-zips'));
const artifacts=JSON.parse(readFileSync(join(root,'terminal-metadata/artifacts.json'),'utf8'));
const prior=JSON.parse(readFileSync(join(root,'terminal-metadata/existing-zip-audit.json'),'utf8'));
const runs=JSON.parse(readFileSync(join(root,'terminal-metadata/runs.json'),'utf8'));
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const results:any[]=[];const logs:any[]=[];const errors:string[]=[];
const selected=/^(ci-plan$|ci-results-|desktop-offline-|design-review-|theme-screenshots-(development|production)-[12]$|doc-(callback-lifetimes|responsiveness)-(desktop|mobile)$|sized-restore-acceptance$|storybook-review$)/;
try {
 const ordered=artifacts.filter((a:any)=>selected.test(a.name)).sort((a:any,b:any)=>(a.name==='storybook-review'?-1:b.name==='storybook-review'?1:0));
 for(const a of ordered){
  const old=prior.find((x:any)=>x.id===a.id&&x.complete&&x.crcVerified);
  let path:string;let reused=false;
  if(old){path=old.path;reused=true;}
  else{
   if(a.expired)throw new Error(`Expired artifact ${a.id}`);
   path=join(dir,'original-zips',`artifact-${a.id}.zip`);const fd=openSync(path,'wx');
   try{execFileSync('gh',['api','--method','GET',`repos/mxbaylee/spinel/actions/artifacts/${a.id}/zip`],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
  }
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){digest.update(chunk);bytes+=chunk.length;}
  const sha256=digest.digest('hex');
  const record={id:a.id,name:a.name,owner:a.owner,run:a.run,attempt:1,source:'7a0451917ef38524138fa2eac432d4520fbed008',path,reused,bytes,sha256,apiDigest:a.digest,apiBytes:a.size_in_bytes,crcVerified:false};results.push(record);
  if(bytes!==a.size_in_bytes||(a.digest&&a.digest!==`sha256:${sha256}`))throw new Error(`Size/digest mismatch ${a.id}; original retained`);
  execFileSync('unzip',['-tqq',path],{stdio:['ignore','pipe','pipe']});record.crcVerified=true;
  console.log(JSON.stringify({artifact:a.id,name:a.name,reused,bytes}));
  writeFileSync(join(dir,'download-progress.json'),JSON.stringify(results,null,2)+'\n');
 }
 for(const run of runs)for(const job of run.jobs.filter((j:any)=>j.status==='completed'&&j.conclusion!=='skipped')){
  const name=`job-${job.id}.log.gz`;let path=join(root,'resume-collected',name);let reused=true;
  if(!existsSync(path))path=join(root,'collection-story-terminal',name);
  if(!existsSync(path))path=join(root,'collection-first',name);
  if(!existsSync(path)){
   reused=false;path=join(dir,name);const raw=execFileSync('gh',['api','--method','GET',`repos/mxbaylee/spinel/actions/jobs/${job.id}/logs`,'--allow-escape-sequences'],{maxBuffer:128*1024*1024});writeFileSync(path,gzipSync(raw),{flag:'wx'});
  }
  const stored=readFileSync(path),decoded=gunzipSync(stored);logs.push({job:job.id,name:job.name,run:run.id,conclusion:job.conclusion,path,reused,bytes:stored.length,sha256:hash(stored),decodedBytes:decoded.length,decodedSha256:hash(decoded)});
 }
}catch(error){errors.push(String(error));process.exitCode=1;console.error(String(error));}
finally{
 writeFileSync(join(dir,'collection-summary.json'),JSON.stringify({source:'7a0451917ef38524138fa2eac432d4520fbed008',base:'c525aa933505d6e78b8fdd7a89940d87506d5cb3',observedAt:new Date().toISOString(),snapshot:'terminal-metadata',artifacts:results,logs,errors,archiveReady:false,note:'Bounded original-attempt GET collection. All three original-attempt workflows terminal success at snapshot. No product rerun or overwrite of complete/partial originals.'},null,2)+'\n');
}
