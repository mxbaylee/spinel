import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.argv[2];
const result=[];
for(const file of fs.readdirSync(root).filter(file=>file.endsWith('.log'))){
 const lines=fs.readFileSync(path.join(root,file),'utf8').split('\n').map(line=>line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /,''));
 const records=[];
 for(let i=0;i<lines.length;i++){
  if(!lines[i].includes('"kind": "ubuntu-mirror-input"'))continue;
  let parsed;
  for(let j=i+1;j<Math.min(lines.length,i+150);j++){
   try{parsed=JSON.parse(lines.slice(i-1,j+1).join('\n'));break;}catch{}
  }
  assert.ok(parsed,`missing mirror evidence in ${file}`);
  const redacted=parsed.lines.some((line:any)=>line.text==='[unsupported line redacted]');
  const original=parsed.lines.map((line:any)=>line.text).join('\n');
  if(!redacted){assert.equal(Buffer.byteLength(original),parsed.bytes);assert.equal(createHash('sha256').update(original).digest('hex'),parsed.sha256);}
  records.push({...parsed,reconstructable:!redacted});
 }
 const imageStart=lines.indexOf('##[group]Runner Image');
 const imageLines=imageStart<0?[]:lines.slice(imageStart+1,lines.indexOf('##[endgroup]',imageStart+1));
 const runnerImage=Object.fromEntries(imageLines.map(line=>{const colon=line.indexOf(': ');return colon<0?['unknown',line]:[line.slice(0,colon),line.slice(colon+2)];}));
 if(records.length)result.push({file,runnerImage,strictFailure:lines.some(line=>line.includes('Error: Unexpected /etc/apt/apt-mirrors.txt')),records});
}
console.log(JSON.stringify(result,null,2));
