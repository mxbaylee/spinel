// GET-only bounded streamed collector; originals retained, no re-download/retry of an inventoried ID.
import {spawn} from 'node:child_process';
import{existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync,createReadStream,statSync,renameSync}from'node:fs';
import{join}from'node:path';import{createHash}from'node:crypto';
const publication='/tmp/spn128-publication-628d7798/validation',root='/tmp/spn128-terminal-628d7798';mkdirSync(join(root,'raw-artifacts'),{recursive:true});
const snapshot=JSON.parse(readFileSync(join(publication,'latest.json'),'utf8'));
if(snapshot.source!=='628d77987e7d9a08863465a7553a2ed82579728b'||snapshot.base!=='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d')throw Error('Snapshot source/base differs');
const path=join(root,'artifact-downloads.json');const previous=existsSync(path)?JSON.parse(readFileSync(path,'utf8')).artifacts:[];const results:any[]=[...previous];
const artifacts=snapshot.workflows.flatMap((w:any)=>w.artifacts.map((a:any)=>({...a,kind:w.kind,run:w.id})));
async function hash(path:string){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function download(a:any){if(previous.some((x:any)=>x.id===a.id))return;
 if(a.size_in_bytes>1024*1024*1024)throw Error('Single artifact exceeds bounded one-GiB download; coordinate selective evidence preservation');
 const existing=join(publication,'original-zips',`artifact-${a.id}.zip`),target=existsSync(existing)?existing:join(root,'raw-artifacts',`artifact-${a.id}.zip`);
 const r:any={id:a.id,name:a.name,kind:a.kind,run:a.run,source:snapshot.source,apiBytes:a.size_in_bytes,apiDigest:a.digest,path:target,reused:existsSync(existing),expired:a.expired};results.push(r);
 try{if(a.expired)throw Error('Expired artifact');if(!r.reused){const part=target+'.partial',fd=openSync(part,'wx');try{await new Promise<void>((resolve,reject)=>{const child=spawn('gh',['api','--method','GET',`repos/mxbaylee/spinel/actions/artifacts/${a.id}/zip`,'--allow-escape-sequences'],{stdio:['ignore',fd,'pipe']});let err='';child.stderr.on('data',b=>err+=b);const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Error(`GET exit${code}: ${err}`));});});}finally{closeSync(fd);}renameSync(part,target);}
 r.bytes=statSync(target).size;r.sha256=await hash(target);if(r.bytes!==a.size_in_bytes||a.digest&&a.digest!=='sha256:'+r.sha256)throw Error('ZIP size/digest mismatch');r.complete=true;
 }catch(e){r.error=String(e);r.complete=false;}
 writeFileSync(path,JSON.stringify({at:new Date().toISOString(),snapshot:snapshot.snapshot,artifacts:results},null,2)+'\n');console.log(JSON.stringify({id:a.id,name:a.name,bytes:r.bytes,complete:r.complete,error:r.error}));
}
let index=0;await Promise.all([0,1].map(async()=>{while(index<artifacts.length)await download(artifacts[index++]);}));
console.log(JSON.stringify({total:results.length,failed:results.filter(r=>!r.complete).length}));
