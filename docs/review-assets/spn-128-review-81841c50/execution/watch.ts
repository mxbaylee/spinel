import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [name,...args]=process.argv.slice(2); const start=Date.now(); let peakKiB=0; let reason:string|null=null;
const pressure=()=>Number(execFileSync('sysctl',['-n','kern.memorystatus_vm_pressure_level'],{encoding:'utf8'}).trim());
if(pressure()!==1) throw new Error('Memory pressure elevated before start');
const child=spawn(process.execPath,['scripts/serial.ts',...args],{stdio:'inherit'});
const monitor=setInterval(()=>{try {const rows=execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number)); const ids=new Set([child.pid]); for(let old=-1;old!==ids.size;){old=ids.size;for(const [pid,ppid] of rows) if(ids.has(ppid)) ids.add(pid);} const rss=rows.filter(r=>ids.has(r[0])).reduce((s,r)=>s+r[2],0);peakKiB=Math.max(peakKiB,rss);if(rss>2097152||pressure()!==1||Date.now()-start>480000){reason??='Resource guard';child.kill('SIGTERM');}}catch(e){reason??=String(e);child.kill('SIGTERM');}},200);
child.on('error',e=>{reason=String(e);});
child.on('close',(code,signal)=>{clearInterval(monitor);const result={name,args,code,signal,reason,elapsedMs:Date.now()-start,peakKiB};writeFileSync(`/tmp/spinel-dependabot-2026-11-11/${name}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=reason?1:code??1;});
