import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const base='/tmp/spinel-socket-closure-registration';
const terminal=base+'/hosted/2026-11-15T01-20-39-800Z-terminal';
const dir=base+'/hosted/2026-11-15-log-reader-repair';mkdirSync(dir);
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const entries:unknown[]=[];
for(const name of ['ci','storybook']){
 const data=JSON.parse(readFileSync(`${terminal}/jobs-${name}.json`,'utf8'));
 for(const job of data.jobs){
  assert.equal(job.status,'completed');if(job.conclusion==='skipped')continue;
  const args=['api','--allow-escape-sequences','--method','GET',`repos/mxbaylee/spinel/actions/jobs/${job.id}/logs`];
  const start=Date.now();const r=spawnSync('gh',args,{encoding:null,timeout:30000,maxBuffer:16*1024*1024});
  const raw=r.stdout??Buffer.alloc(0);const compressed=gzipSync(raw);
  writeFileSync(`${dir}/job-${job.id}.log.gz`,compressed,{flag:'wx'});
  if(r.stderr?.length)writeFileSync(`${dir}/job-${job.id}.stderr`,r.stderr,{flag:'wx'});
  entries.push({id:job.id,name:job.name,workflow:name,args,code:r.status,signal:r.signal,error:r.error?.message,elapsedMs:Date.now()-start,rawBytes:raw.length,rawSha256:sha(raw),gzipBytes:compressed.length,gzipSha256:sha(compressed)});
  writeFileSync(dir+'/requests.json',JSON.stringify(entries,null,2)+'\n');
  assert.equal(r.status,0,'Stop on actual read failure; no automatic retry');
 }
}
writeFileSync(dir+'/reader-disposition.json',JSON.stringify({originalDirectory:terminal,originalFailure:'gh api refused first log output because it contained terminal escape sequences; empty stdout and exact stderr/request retained',repair:'Explicit --allow-escape-sequences, captured as bytes directly to compressed files; not emitted to terminal. Only missing job logs collected. No workflow rerun, new validation attempt or artifact re-download.',originalHelper:base+'/collect-hosted.ts',replacementHelper:base+'/collect-missing-logs.ts',logs:entries.length},null,2)+'\n');
console.log(JSON.stringify({directory:dir,logs:entries.length}));
