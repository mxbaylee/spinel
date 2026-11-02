// Diagnostic-only replay of synthetic native operation captures. No production admission change.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';
import { prepareDocsPatch } from '/Users/mxbaylee/projects/spinel-spn-133/scripts/dependencies/patch-univer-docs.ts';
const runtime='/Users/mxbaylee/projects/spinel-spn-098';
const require=createRequire(runtime+'/package.json');
const core=require('@univerjs/core');
const capturePath='/tmp/spn071-review/allocation-proof-archive/spn071-native-cache-shapes.json';
const raw=fs.readFileSync(capturePath);const capture=JSON.parse(raw.toString());
const decode=(v:any):any=>{if(v.kind==='undefined')return undefined;if(v.kind==='value')return v.value;const out:any=v.kind==='array'?[]:{};for(const [k,c]of v.entries)out[k]=decode(c);return out;};
assert.equal(capture.captures.length,8);
const results:any[]=[];
function differences(a:any,b:any,p='$',out:any[]=[]):any[]{
 if(out.length>=4||isDeepStrictEqual(a,b))return out;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'){out.push({path:p,a:a===undefined?'<own undefined>':a,b:b===undefined?'<own undefined>':b});return out;}
 for(const k of new Set([...Reflect.ownKeys(a),...Reflect.ownKeys(b)])){
  if(!Object.hasOwn(a,k)||!Object.hasOwn(b,k)){out.push({path:p+'.'+String(k),aOwn:Object.hasOwn(a,k),bOwn:Object.hasOwn(b,k)});if(out.length>=4)break;}
  else differences(a[k],b[k],p+'.'+String(k),out);
 }
 return out;
}
function measured(fn:Function,states:any[],key:string){
 const clone=core.Tools.deepClone;const next=core.ActionIterator.prototype.next;
 const counts={cloneVisits:0,allocations:0,iteratorNext:0};
 core.Tools.deepClone=function(value:any){counts.cloneVisits++;if(this.isDefine(value)&&(this.isRegExp(value)||this.isDate(value)||this.isArray(value)||this.isObject(value)))counts.allocations++;return Reflect.apply(clone,this,[value]);};
 core.ActionIterator.prototype.next=function(...args:any[]){counts.iteratorNext++;return Reflect.apply(next,this,args);};
 try{return{actions:fn(states,key),counts};}finally{core.Tools.deepClone=clone;core.ActionIterator.prototype.next=next;}
}
for(const format of ['es','cjs'] as const){
 const source=fs.readFileSync(runtime+'/node_modules/@univerjs/docs/lib/'+format+'/index.js','utf8');assert.equal(prepareDocsPatch(source,format).patched,source);
 const start=source.indexOf('function hasOnlyDocInsertKeys('),end=source.indexOf('const IDocStateChangeInterceptorService =',start);assert.ok(start>0&&end>start);
 const helper=source.slice(start,end);const json=format==='es'?'JSONX':'_univerjs_core.JSONX';
 const guard=`if (!canBalanceDocInserts(states, key)) return states.reduce((acc, state) => ${json}.compose(acc, state[key].actions), null);`;
 assert.equal(helper.split(guard).length,2);
 const context={JSONX:core.JSONX,_univerjs_core:core};
 const current=runInNewContext(helper+';composeDocStateActions;',context);
 const prefixSource=helper.replace(guard,`if (!canBalanceDocInserts(states, key)) { let prefix=states.length-1; while(prefix>=2&&!canBalanceDocInserts(states.slice(0,prefix),key))prefix--; if(prefix<2)return states.reduce((acc,state)=>${json}.compose(acc,state[key].actions),null); const head=composeRange(0,prefix);return states.slice(prefix).reduce((acc,state)=>${json}.compose(acc,state[key].actions),head); }`);
 const forced=runInNewContext(prefixSource+';composeDocStateActions;',context);
 const chronological={history:capture.captures.flatMap((e:any)=>decode(e).history),collaboration:capture.captures.flatMap((e:any)=>decode(e).collaboration)};
 const cases=[...capture.captures.map((e:any,index:number)=>({index:'original-'+index,cache:decode(e)})),...Array.from({length:32},(_,position)=>({index:'paragraph-position-'+position,cache:{history:chronological.history.slice(129-position,161-position),collaboration:chronological.collaboration.slice(129-position,161-position)}}))];
 for(const {index,cache}of cases)for(const scope of ['history','collaboration'])for(const key of ['redoState','undoState']){
  const states=cache[scope].slice();if(key==='undoState')states.reverse();const before=core.Tools.deepClone(states);
  const control=measured(current,states,key);assert.ok(isDeepStrictEqual(states,before),'Current input mutation');
  const candidate=measured(forced,states,key);assert.ok(isDeepStrictEqual(states,before),'Experimental input mutation');
  results.push({format,index,scope,key,states:states.length,equal:isDeepStrictEqual(control.actions,candidate.actions),current:control.counts,prefixExperiment:candidate.counts,differences:differences(control.actions,candidate.actions)});
 }
}
const report={diagnosticOnly:true,captureSource:capture.source,captureSha256:createHash('sha256').update(raw).digest('hex'),runtime:'SPN098 private clean install at24e00a7, read-only pinned Docs hash verified',cases:results.length,equal:results.filter(r=>r.equal).length,results};
fs.writeFileSync('/tmp/spn133-review/captured-prefix-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:report.cases,equal:report.equal,mismatches:results.filter(r=>!r.equal),representative:results.filter(r=>r.format==='es'&&r.scope==='history'&&r.key==='redoState'&&['original-4','paragraph-position-0','paragraph-position-1','paragraph-position-8','paragraph-position-16','paragraph-position-19','paragraph-position-24','paragraph-position-31'].includes(r.index))},null,2));
