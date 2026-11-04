import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire('/Users/mxbaylee/projects/spinel/package.json');
const yauzl=require('yauzl');
async function members(path:string, omit:boolean):Promise<Record<string,{bytes:number,sha256:string}>> {
 return new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true},(error:any,zip:any)=>{
  if(error)return reject(error);const result:Record<string,{bytes:number,sha256:string}>={};
  zip.on('error',reject);zip.on('end',()=>resolve(result));
  zip.on('entry',(e:any)=>{
   if(e.fileName.endsWith('/')||(omit&&e.fileName.includes('.sqlite'))){zip.readEntry();return;}
   zip.openReadStream(e,(err:any,stream:any)=>{
    if(err)return reject(err);const hash=createHash('sha256');let bytes=0;
    stream.on('error',reject);stream.on('data',(chunk:Buffer)=>{bytes+=chunk.length;hash.update(chunk);});
    stream.on('end',()=>{result[e.fileName]={bytes,sha256:hash.digest('hex')};zip.readEntry();});
   });
  });zip.readEntry();
 }));
}
const [original,filtered,destination]=process.argv.slice(2);
const expected=await members(original,true),actual=await members(filtered,false);
assert.deepEqual(actual,expected);
writeFileSync(destination,JSON.stringify({original,filtered,omitted:'Only *.sqlite* disposable fixture files',members:actual,count:Object.keys(actual).length,verified:true},null,2)+'\n');
console.log(JSON.stringify({verified:true,count:Object.keys(actual).length}));
