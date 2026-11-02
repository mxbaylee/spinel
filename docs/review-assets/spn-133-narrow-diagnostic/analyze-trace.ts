import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root=process.argv[2];
if(!root) throw Error('Expected extracted diagnostic directory');
type Event={name?:string;cat?:string;ph?:string;ts?:number;dur?:number;pid?:number;tid?:number;id?:string;id2?:{local?:string;global?:string}};
for(const rel of fs.readdirSync(root,{recursive:true}).map(String).filter(n=>n.endsWith('spn108-metrics.json'))){
 const dir=path.dirname(path.join(root,rel));
 const m=JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
 const bytes=fs.readFileSync(path.join(dir,'spn133-trace.json'));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 assert.equal(m.diagnosticTrace?.complete,true);
 assert.equal(sha256,m.diagnosticTrace.sha256);
 const events=JSON.parse(bytes.toString()).traceEvents as Event[];
 const starts=events.filter(e=>e.name==='spn133-clock-start'&&typeof e.ts==='number');
 const ends=events.filter(e=>e.name==='spn133-clock-end'&&typeof e.ts==='number');
 assert.equal(starts.length,1);assert.equal(ends.length,1);
 const a=starts[0]!,b=ends[0]!;
 const offset=a.ts!-m.traceClockStart*1000;
 const endOffset=b.ts!-m.traceClockEnd*1000;
 assert.equal(a.pid,b.pid);assert.equal(a.tid,b.tid);assert.ok(b.ts!>a.ts!);assert.ok(m.traceClockEnd>m.traceClockStart);
 assert.ok(Math.abs(endOffset-offset)<2000,'Clock anchors drifted over 2 ms');
 const timeline=events.filter(e=>e.pid===a.pid&&e.tid===a.tid).sort((a,b)=>(a.ts??0)-(b.ts??0));
 const stack:Event[]=[];const spans:Event[]=[];const asyncSpans=new Map<string,Event>();
 for(const e of timeline){if(e.name?.startsWith('spn133-native-')&&(e.ph==='b'||e.ph==='e')){const key=e.name+'|'+(e.id2?.local??e.id2?.global??e.id);if(e.ph==='b'){assert.ok(!asyncSpans.has(key));asyncSpans.set(key,e);}else{const start=asyncSpans.get(key);assert.ok(start?.ts!==undefined&&e.ts!==undefined);spans.push({...start,dur:e.ts!-start.ts!});asyncSpans.delete(key);}continue;}if(e.ph==='X'&&typeof e.dur==='number')spans.push(e);else if(e.ph==='B')stack.push(e);else if(e.ph==='E'){const start=stack.pop();if(start?.ts!==undefined&&e.ts!==undefined)spans.push({...start,dur:e.ts-start.ts});}}
 assert.equal(asyncSpans.size,0,'Incomplete native phase spans');
 const nativeSpans=spans.filter(e=>e.name?.startsWith('spn133-native-'));
 const coverage=m.native.flushes.map((f:any)=>{const begin=offset+f.startedAt*1000,end=begin+f.durationMs*1000;assert.ok(begin>=a.ts!-1000&&end<=b.ts!+1000,'Flush outside clock anchors');const phases=nativeSpans.filter(e=>e.ts!>=begin-1000&&e.ts!+(e.dur??0)<=end+1000);for(const name of ['spn133-native-history','spn133-native-collaboration'])assert.equal(phases.filter(e=>e.name===name).length,1,'Missing or ambiguous native phase');return phases;});
 const selected=[...m.native.flushes].sort((a,b)=>b.durationMs-a.durationMs).slice(0,8).map(f=>{
  const begin=offset+f.startedAt*1000,end=begin+f.durationMs*1000;
  const overlaps=spans.filter(e=>e.ts!==undefined&&e.ts<end&&e.ts+(e.dur??0)>begin);
  const gc=overlaps.filter(e=>/GC|Scavenge|MarkCompact/i.test(e.name??''));
  const intervals=gc.map(e=>[Math.max(begin,e.ts!),Math.min(end,e.ts!+(e.dur??0))]).sort((a,b)=>a[0]-b[0]);
  let sum=0,lo=0,hi=0;for(const [a,b] of intervals){if(a>hi){sum+=hi-lo;lo=a;hi=b;}else hi=Math.max(hi,b);}sum+=hi-lo;
  return{flush:f,nativePhases:coverage[m.native.flushes.indexOf(f)].map(e=>({name:e.name,durationMs:(e.dur??0)/1000})),gcUnionOverlapMs:sum/1000,gc:gc.map(e=>({name:e.name,ts:e.ts,durationMs:(e.dur??0)/1000})),longest:overlaps.sort((a,b)=>(b.dur??0)-(a.dur??0)).slice(0,8).map(e=>({name:e.name,cat:e.cat,ts:e.ts,durationMs:(e.dur??0)/1000}))};
 });
 const result={source:m.source,preset:m.preset,sample:m.sample,attempt:m.attempt,diagnosticOnly:true,completed:m.completed,errors:m.errors,preUndoIntegrity:m.preUndoIntegrity?.passed,undoRedo:m.undoRedo?.outcome,budgetResults:m.budgetResults,traceSha256:sha256,coveredFlushes:coverage.length,nativePhaseSpans:nativeSpans.length,events:events.length,offset,clockDriftMs:(endOffset-offset)/1000,selected};
 fs.writeFileSync(path.join(dir,'spn133-trace-analysis.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,selected:selected.map(x=>({flush:x.flush,nativePhases:x.nativePhases,gcUnionOverlapMs:x.gcUnionOverlapMs,gcNames:[...new Set(x.gc.map(e=>e.name))]}))},null,2));
}
