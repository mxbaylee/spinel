import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {crc32} from 'node:zlib';
const require=createRequire('/Users/mxbaylee/projects/spinel/package.json');const yauzl=require('yauzl');
const root='/tmp/spn144-hosted',input=root+'/responsiveness-desktop.zip',dest=root+'/responsiveness-desktop';
let zipBytes=0;const zipHash=createHash('sha256');for await(const c of createReadStream(input)){zipBytes+=c.length;zipHash.update(c);}const zipSha=zipHash.digest('hex');assert.equal(zipBytes,1686582);assert.equal(zipSha,'d2b65e6e6c5968a6f4bcf45558fc69067154dc926c9700c499e228875943217a');
await mkdir(dest);const members:any[]=[];const names=new Set<string>();
await new Promise<void>((done,reject)=>yauzl.open(input,{lazyEntries:true},(error:any,zip:any)=>{if(error)return reject(error);zip.on('error',reject);zip.on('end',done);zip.on('entry',(e:any)=>{
 if(e.fileName.endsWith('/')){zip.readEntry();return;}const file=resolve(dest,e.fileName);if(!file.startsWith(dest+sep)||names.has(e.fileName))return reject(Error('unsafe/duplicate member'));names.add(e.fileName);
 const omitted=/\.sqlite(?:-|$)/.test(e.fileName);zip.openReadStream(e,(error:any,s:any)=>{if(error)return reject(error);void(async()=>{let bytes=0,crc=0;const hash=createHash('sha256');const counter=new Transform({transform(c,_e,cb){bytes+=c.length;crc=crc32(c,crc);hash.update(c);cb(null,c);}});if(!omitted)await mkdir(dirname(file),{recursive:true});await pipeline(s,counter,omitted?new Writable({write(_c,_e,cb){cb();}}):createWriteStream(file,{flags:'wx'}));assert.equal(bytes,e.uncompressedSize);assert.equal(crc,e.crc32);const sha256=hash.digest('hex');if(!omitted){const h=createHash('sha256');let n=0;for await(const c of createReadStream(file)){h.update(c);n+=c.length;}assert.equal(n,bytes);assert.equal(h.digest('hex'),sha256);}members.push({file:e.fileName,bytes,sha256,crc32:crc,omitted,reason:omitted?'disposable SQLite runtime database; original ZIP retained':null});zip.readEntry();})().catch(e=>{zip.close();reject(e);});});});zip.readEntry();}));
assert.equal(members.length,18);assert.equal(members.filter(m=>m.omitted).length,0);
await writeFile(root+'/responsiveness-desktop-members-a.json',JSON.stringify({archive:{bytes:zipBytes,sha256:zipSha},count:members.length,retained:18,omitted:0,method:'all original ZIP members streamed and CRC32/SHA256 verified; non-SQLite extracted exclusively and re-read; original ZIP unchanged',members},null,2)+'\n');console.log(JSON.stringify({zipBytes,zipSha,members:members.length,retained:18,omitted:0}));
