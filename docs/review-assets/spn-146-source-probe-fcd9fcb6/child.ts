import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [mode,root]=process.argv.slice(2),started=performance.now();
const source=mode==='baseline'?root+'/baseline.ts':'/Users/mxbaylee/projects/spinel-spn-146/e2e/doc-responsiveness-native-sources.ts';
const record:any={mode,node:process.version,platform:process.platform,scope:'One collector child, Node resourceUsage maxRSS in KiB; not the live browser tree',complete:false,phase:'preflight',secondaryErrors:[]};
let primary:unknown;
try {
 await writeFile(root+'/'+mode+'-resource.json',JSON.stringify(record,null,2));
 const metadata=JSON.parse(await readFile(root+'/input/binding.json','utf8'));
 record.sourceSha256=createHash('sha256').update(await readFile(source)).digest('hex');
 const api=await import(pathToFileURL(source).href);
 record.phase=mode;
 if(mode==='prepare'){
  const prepared=await api.prepareNativeWindowSources(root+'/input',metadata.bindings);
  await writeFile(root+'/prepared.json',JSON.stringify(prepared));
 } else {
  assert.ok(mode==='baseline'||mode==='revised');
  const inventory=JSON.parse(await readFile(root+'/input/inventory.json','utf8'));
  class Session extends EventEmitter {
   commands:string[]=[];
   async send(method:string,args?:{scriptId:string}){
    this.commands.push(method);
    if(method==='Debugger.enable') for(const row of inventory) this.emit('Debugger.scriptParsed',row);
    if(method==='Debugger.getScriptSource'){
     const row=metadata.scripts.find((row:any)=>row.scriptId===args?.scriptId);assert.ok(row,'Only retained generated scripts may load');
     return {scriptSource:await readFile(root+'/input/'+row.path,'utf8')};
    }
    return {};
   }
  }
  const session=new Session(),origin=new URL(metadata.scripts[0].url).origin;
  const observer=await api.observeNativeWindowSources(session,origin);
  let retainFailure:unknown;
  try {
   const prepared=mode==='revised'?JSON.parse(await readFile(root+'/prepared.json','utf8')):undefined;
   const receipt=mode==='baseline'?await observer.retain(root+'/'+mode,metadata.bindings,root+'/input'):await observer.retain(root+'/'+mode,metadata.bindings,prepared,root+'/input');
   assert.deepEqual(receipt,metadata,'Actual retained byte/source receipt must remain identical');
  } catch(error){retainFailure=error;throw error;}
  finally {try{await observer.dispose();}catch(error){record.secondaryErrors.push({phase:'observer-dispose',error:String(error)});if(!retainFailure)throw error;}}
  assert.equal(session.listenerCount('Debugger.scriptParsed'),0);record.commands=session.commands;
 }
 record.complete=true;record.phase='settled';
} catch(error){primary=error;record.error=String(error);record.complete=false;}
finally {
 record.elapsedMs=performance.now()-started;record.maxRSSKiB=process.resourceUsage().maxRSS;
 try{await writeFile(root+'/'+mode+'-resource.json',JSON.stringify(record,null,2));}
 catch(error){console.error('Secondary resource receipt failure',String(error));primary??=error;}
}
if(primary)throw primary;
