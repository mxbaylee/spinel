import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=process.cwd();
const {headingAnchors}=await import(pathToFileURL(resolve(root,'scripts/backlog/lib.ts')).href);
const base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'});
const paths=['docs/todo/SPN-128.md','docs/todo/SPN-161.md','docs/implementation/SPN-128.md','docs/implementation/SPN-161.md','docs/implementation/grooming-revoked-socket-closure-2026-11-14.md'];
const links:any[]=[];
for(const path of paths){
 const text=readFileSync(path,'utf8');
 for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const target=m[1]; if(/^[a-z]+:\/\//.test(target))continue;
  const [file,anchor]=target.split('#'); const actual=resolve(dirname(resolve(root,path)),file||path.split('/').at(-1)!);
  assert(existsSync(actual),`${path}: missing ${target}`);
  if(anchor)assert(headingAnchors(readFileSync(actual,'utf8')).has(anchor),`${path}: missing anchor ${target}`);
  links.push({path,target});
 }
}
const before=git('show',`${base}:docs/todo/SPN-128.md`);
let after=readFileSync('docs/todo/SPN-128.md','utf8');
after=after.replace('depends_on: [SPN-161]','depends_on: []').replace(/- Current d22 validation[^\n]*\n\n/,'');
assert.equal(after,before,'SPN-128 existing complete specification changed');
const oldConfig=JSON.parse(git('show',`${base}:docs/todo/backlog.json`));
const config=JSON.parse(readFileSync('docs/todo/backlog.json','utf8'));
assert.equal(oldConfig.next_id,161);assert.equal(config.next_id,162);
assert.deepEqual({...config,next_id:161},oldConfig);
const out={base,linksChecked:links.length,links,allocation:{before:161,after:162,cliReceipt:'/tmp/spinel-dependabot-2026-11-11/revoked-socket-registration-allocate161.json'},original128Specification:'byte-identical after removing only the new dependency and Rule',groomingPreserved:config.grooming,runtimeWork:'none; docs-only registration',failures:[]};
writeFileSync('/tmp/spinel-socket-closure-registration/docs-inspection.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out));
