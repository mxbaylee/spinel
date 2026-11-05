import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import assert from 'node:assert/strict';
const require=createRequire('/Users/mxbaylee/projects/spinel/package.json');
const yauzl=require('yauzl');
const [input,destination,manifest]=process.argv.slice(2);
const root=resolve(destination);
await mkdir(root); // Never overwrite an earlier package.
const members:Record<string,{bytes:number;sha256:string}>={};
const omitted:string[]=[];
await new Promise<void>((done,reject)=>yauzl.open(input,{lazyEntries:true},(error:any,zip:any)=>{
 if(error)return reject(error);
 zip.on('error',reject);zip.on('end',done);
 zip.on('entry',(entry:any)=>{
  if(entry.fileName.endsWith('/')){zip.readEntry();return;}
  if(entry.fileName.includes('.sqlite')){omitted.push(entry.fileName);zip.readEntry();return;}
  const file=resolve(root,entry.fileName);
  if(!file.startsWith(root+sep)||members[entry.fileName])return reject(new Error('Unsafe/duplicate member path'));
  if(entry.uncompressedSize>=100*1024*1024)return reject(new Error('Member exceeds durable Git blob bound'));
  zip.openReadStream(entry,(error:any,inputStream:any)=>{
   if(error)return reject(error);
   void (async()=>{
    await mkdir(dirname(file),{recursive:true});
    let bytes=0;const hash=createHash('sha256');
    const counter=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;hash.update(chunk);callback(null,chunk);}});
    await pipeline(inputStream,counter,createWriteStream(file,{flags:'wx'}));
    assert.equal(bytes,entry.uncompressedSize);
    const expected=hash.digest('hex');let retainedBytes=0;const retainedHash=createHash('sha256');
    for await(const chunk of createReadStream(file,{highWaterMark:65536})){retainedBytes+=chunk.length;retainedHash.update(chunk);}
    assert.equal(retainedBytes,bytes);assert.equal(retainedHash.digest('hex'),expected);
    members[entry.fileName]={bytes,sha256:expected};zip.readEntry();
   })().catch(error=>{zip.close();reject(error);});
  });
 });zip.readEntry();
}));
assert.equal(Object.keys(members).length,77);
await writeFile(manifest,JSON.stringify({input,root,count:77,omitted,members,verified:true,method:'Streamed each non-SQLite original ZIP member to an exclusive file, then re-read and matched its full byte length and SHA256. Inner gzip traces remain untouched.'},null,2)+'\n');
console.log(JSON.stringify({verified:true,count:77,omitted:omitted.length}));
