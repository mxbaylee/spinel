import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo='/Users/mxbaylee/projects/spinel-spn-128-production';
const git=(a:string[],input?:string)=>execFileSync('git',a,{cwd:repo,input,maxBuffer:50*1024*1024});
const id=JSON.parse(readFileSync('/tmp/spn128-final-acceptance-d22baa69/validation-archive-seal.json','utf8'));
const m=JSON.parse(readFileSync(id.archive+'/manifest.json','utf8'));
assert.equal(git(['rev-list','--parents','-n','1',id.commit]).toString().trim(),id.commit+' '+m.source);
const paths=[...m.files.map((f:any)=>f.path),'manifest.json'].sort();
const changes=git(['diff','--name-status','-z',m.source,id.commit]).toString().split('\0').slice(0,-1);
assert.deepEqual(changes,paths.flatMap(p=>['A',id.prefix+'/'+p]));
const response=git(['cat-file','--batch'],paths.map(p=>id.commit+':'+id.prefix+'/'+p+'\n').join(''));
let offset=0;
for(const p of paths){const end=response.indexOf(10,offset);assert(end>offset);const [oid,type,size]=response.subarray(offset,end).toString().split(' ');assert.equal(type,'blob');const bytes=Number(size);assert(Number.isSafeInteger(bytes));const body=response.subarray(end+1,end+1+bytes);assert.deepEqual(body,readFileSync(id.archive+'/'+p));assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes}\0`)).update(body).digest('hex'),oid);offset=end+1+bytes;assert.equal(response[offset++],10);}
assert.equal(offset,response.length);assert.equal(git(['rev-parse','HEAD']).toString().trim(),m.source);assert.equal(git(['status','--porcelain=v1']).length,0);
const result={at:new Date().toISOString(),commit:id.commit,parent:m.source,prefix:id.prefix,gitBlobs:paths.length,allGitPayloadBytesVerified:true,exclusiveAddedPaths:true,acceptance:m.acceptance,readerCorrection:'First reader compared Git quoted non-ASCII paths to literal paths and stopped before blob audit. Preserved first helper; corrected reader consumes NUL-delimited paths. Evidence unchanged.'};writeFileSync('/tmp/spn128-root-sealed-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
