import fs from 'node:fs';import path from 'node:path';
const root=process.argv[2];const file=fs.readdirSync(root,{recursive:true}).map(String).find(n=>n.endsWith('spn135-trace.json'))!;
const events=JSON.parse(fs.readFileSync(path.join(root,file),'utf8')).traceEvents;
const marks=events.filter((e:any)=>e.name?.startsWith('spn135-'));
const counts=Object.create(null);for(const e of marks){const key=e.name+' '+e.ph;counts[key]=(counts[key]??0)+1;}
console.log(JSON.stringify({counts,first:marks.slice(0,30),last:marks.slice(-35)},null,2));
