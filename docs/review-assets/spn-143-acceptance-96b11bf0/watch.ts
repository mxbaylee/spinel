import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const root='/tmp/spn143-hosted';
const watches=[['ci',41937955289],['storybook',41937955238],['main',41934371166]] as const;
const previous=new Map<string,string>();
for (;;) {
 let complete=true;
 for (const [name,id] of watches) {
  const api=(path:string,...options:string[])=>execFileSync('gh',['api',`repos/mxbaylee/spinel/${path}`,...options],{encoding:'utf8',maxBuffer:8*1024*1024});
  try {
   const raw=api(`actions/runs/${id}`);writeFileSync(`${root}/${name}-run.json`,raw);
   const run=JSON.parse(raw);complete&&=run.status==='completed';
   const rawJobs=api(`actions/runs/${id}/jobs`,'--paginate','--slurp');writeFileSync(`${root}/${name}-jobs.json`,rawJobs);
   const jobs=JSON.parse(rawJobs).flatMap((p:any)=>p.jobs);
   const state=JSON.stringify({name,id,status:run.status,conclusion:run.conclusion,success:jobs.filter((j:any)=>j.conclusion==='success').length,failed:jobs.filter((j:any)=>j.conclusion==='failure').map((j:any)=>({id:j.id,name:j.name})),active:jobs.filter((j:any)=>j.status==='in_progress').map((j:any)=>({id:j.id,name:j.name})),queued:jobs.filter((j:any)=>j.status==='queued').length});
   if(previous.get(name)!==state){console.log(new Date().toISOString(),state);previous.set(name,state);}
  } catch(error) {complete=false;console.log(new Date().toISOString(),name,String(error));}
 }
 if(complete)break;
 await new Promise(resolve=>setTimeout(resolve,30_000));
}
