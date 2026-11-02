import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
const root=process.argv[2];
for(const rel of fs.readdirSync(root,{recursive:true}).map(String).filter(f=>f.endsWith('spn133-trace.json'))){
 const names=new Map<string,{count:number,bytes:number}>();let malformed=0,total=0,min=Infinity,max=0;const marks:unknown[]=[];
 for await(const line of readline.createInterface({input:fs.createReadStream(path.join(root,rel)),crlfDelay:Infinity})){
  const text=line.trim().replace(/,$/,'');if(!text||text==='{"traceEvents":[')continue;
  let e;try{e=JSON.parse(text);}catch{malformed++;continue;}total++;
  const key=e.cat+' / '+e.name,entry=names.get(key)??{count:0,bytes:0};entry.count++;entry.bytes+=Buffer.byteLength(line);names.set(key,entry);
  if(e.ts>0){min=Math.min(min,e.ts);max=Math.max(max,e.ts);}
  if(String(e.name).startsWith('spn133-clock'))marks.push(e);
 }
 const result={rel,total,malformed,min,max,marks,top:[...names].sort((a,b)=>b[1].bytes-a[1].bytes).slice(0,20)};
 fs.writeFileSync(path.join(path.dirname(path.join(root,rel)),'spn133-partial-inventory.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
