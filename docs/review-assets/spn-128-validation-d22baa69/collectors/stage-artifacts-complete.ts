import{readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync,readSync,statSync,createReadStream,createWriteStream,copyFileSync}from'node:fs';
import{join,dirname}from'node:path';import{createHash}from'node:crypto';import{createInflateRaw,createGzip,crc32}from'node:zlib';import{once}from'node:events';
const root='/tmp/spn128-terminal-d22baa69',out=join(root,'archive');mkdirSync(out,{recursive:true});
const list=JSON.parse(readFileSync(join(root,'artifact-downloads.json'),'utf8')).artifacts;
const invPath=join(out,'retention-inventory.json'),obsPath=join(out,'raw-outcome-observations.json');
const inventory:any[]=existsSync(invPath)?JSON.parse(readFileSync(invPath,'utf8')):[],observations:any[]=existsSync(obsPath)?JSON.parse(readFileSync(obsPath,'utf8')):[];
const text=/\.(?:log|txt|md)$/;const numeric=/\.(?:json(?:\.gz)?|cpuprofile)$/;
for(const a of list){
 if(!a.complete)throw Error('Incomplete download '+a.id);if(inventory.some(x=>x.id===a.id))continue;
 const fd=openSync(a.path,'r');const read=(at:number,len:number)=>{const b=Buffer.alloc(len);if(readSync(fd,b,0,len,at)!==len)throw Error('Short ZIP read');return b;};
 try{const size=statSync(a.path).size;const tail=read(Math.max(0,size-65557),Math.min(size,65557));let e=tail.length-22;while(e>=0&&tail.readUInt32LE(e)!==0x06054b50)e--;if(e<0)throw Error('EOCD');
 const count=tail.readUInt16LE(e+10),centralSize=tail.readUInt32LE(e+12),centralOffset=tail.readUInt32LE(e+16);if(count===65535||centralSize>32*1024*1024||centralOffset===0xffffffff)throw Error('Unsupported ZIP64');
 const central=read(centralOffset,centralSize);let c=0;const members=[];
 const whole=a.kind==='desktop'||a.kind==='spaces'||/^ci-(plan|results-)/.test(a.name)||a.name==='sized-restore-acceptance'||a.name==='restore-crash-evidence'||a.name==='theme-screenshots-supervised-restore';const wholePath=whole?`original-artifacts/artifact-${a.id}.zip`:null;if(wholePath){mkdirSync(dirname(join(out,wholePath)),{recursive:true});copyFileSync(a.path,join(out,wholePath));}
 for(let i=0;i<count;i++){
  if(central.readUInt32LE(c)!==0x02014b50)throw Error('Central header');const method=central.readUInt16LE(c+10),crc=central.readUInt32LE(c+16),compressed=central.readUInt32LE(c+20),length=central.readUInt32LE(c+24),n=central.readUInt16LE(c+28),extra=central.readUInt16LE(c+30),comment=central.readUInt16LE(c+32),offset=central.readUInt32LE(c+42);const name=central.subarray(c+46,c+46+n).toString();c+=46+n+extra+comment;
  if(name.endsWith('/'))continue;if(name.startsWith('/')||name.split('/').includes('..'))throw Error('Unsafe member');if(![0,8].includes(method))throw Error('Unsupported compression');
  const local=read(offset,30);if(local.readUInt32LE(0)!==0x04034b50)throw Error('Local header');const start=offset+30+local.readUInt16LE(26)+local.readUInt16LE(28);
  const bulky=/spn144-derived\.json\.gz$|(?:^|\/)traceEvents(?:\.|\/)|\.perfetto(?:\.gz)?$/.test(name);
  const failed=/test-failed-\d+\.png$|(?:^|\/)trace\.zip$/.test(name);
  const failedBaselineProto=false; /* Current callbacks passed; old628 failed proto remains separately retained. */const retain=whole||failedBaselineProto||!bulky&&(failed||numeric.test(name)||text.test(name));
  const compressedAlready=/\.(?:gz|zip|png|webm|jpg)$/.test(name);const retainedPath=wholePath??(retain?`members/${a.id}/${name}${compressedAlready?'':'.gz'}`:null);
  let dest:any;let gzip:any;
  if(retain&&!whole){mkdirSync(dirname(join(out,retainedPath!)),{recursive:true});dest=createWriteStream(join(out,retainedPath!));if(!compressedAlready){gzip=createGzip({level:6});gzip.pipe(dest);}}
  const digest=createHash('sha256');let bytes=0,checksum=0;const capture=false&&length<20*1024*1024&&name.endsWith('.json')&&(/comparison|^playwright-report\/|(?:^|\/)evidence\.json$|acceptance/.test(name));const chunks:Buffer[]=[];
  const input=compressed===0?null:createReadStream(a.path,{start,end:start+compressed-1});const decoded=input?(method===8?input.pipe(createInflateRaw()):input):null;
  if(decoded)for await(const raw of decoded){const b=Buffer.from(raw);digest.update(b);checksum=crc32(b,checksum);bytes+=b.length;if(capture)chunks.push(b);if(dest){const output=gzip??dest;if(!output.write(b))await once(output,'drain');}}
  if(dest){const finished=once(dest,'finish');(gzip??dest).end();await finished;}
  if(bytes!==length||checksum!==crc)throw Error('CRC/size '+a.id+'/'+name);
  const sha=digest.digest('hex');members.push({name,bytes:length,compressedBytes:compressed,crc32:crc.toString(16).padStart(8,'0'),sha256:sha,retainedPath,retention:whole?'complete original ZIP':retain?'complete original member; gzip wrapper only where noted':'original private ZIP plus expiring supplementary artifact; successful binary/derived traceEvents/source packs/redundant visuals omitted from durable copy'});
  if(capture){const value=JSON.parse(Buffer.concat(chunks).toString());const summary:any={artifactId:a.id,name};for(const key of ['status','passed','accepted','timingValid','candidateIntegrity','failures','stats','scope','sourceCommit','source','testedCommit','checks','cleanup','comparison'])if(key in value)summary[key]=value[key];observations.push(summary);}
 }
 inventory.push({id:a.id,name:a.name,kind:a.kind,run:a.run,source:a.source,privateOriginalPath:a.path,bytes:a.bytes,sha256:a.sha256,apiDigest:a.apiDigest,crcVerified:true,members});
 writeFileSync(invPath,JSON.stringify(inventory,null,2)+'\n');writeFileSync(obsPath,JSON.stringify(observations,null,2)+'\n');console.log(JSON.stringify({id:a.id,name:a.name,members:members.length,retained:members.filter(m=>m.retainedPath).length}));
 }finally{closeSync(fd);}
}
console.log(JSON.stringify({artifacts:inventory.length,members:inventory.reduce((n,a)=>n+a.members.length,0)}));
