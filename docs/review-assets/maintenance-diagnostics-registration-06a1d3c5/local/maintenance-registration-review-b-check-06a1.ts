import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base='7c38f7d32e6a55d8000239923113155de6a07c8c';
const head='06a1d3c5b7d1b10065b96615cd18e5c4199cbdad';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');
git('diff','--check',base,head);
const files=git('diff','--name-only',base,head).split('\n');let links=0;
for(const file of files.filter(f=>f.endsWith('.md'))){
  for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){
    const target=match[1];if(/^[a-z]+:\/\//.test(target))continue;
    const [path,anchor]=target.split('#');const full=path?resolve(dirname(file),path):resolve(file);
    assert(existsSync(full),`${file}: missing ${target}`);
    if(anchor){const headings=[...readFileSync(full,'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(m=>m[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/\s/g,'-'));
    assert(headings.includes(decodeURIComponent(anchor)),`${file}: missing anchor ${target}`);}
    links++;
  }
}
const before=JSON.parse(git('show',`${base}:docs/todo/backlog.json`));
const after=JSON.parse(readFileSync('docs/todo/backlog.json','utf8'));
assert.equal(before.next_id,160);assert.equal(after.next_id,161);assert.deepEqual(before.grooming,after.grooming);
assert.equal(git('log',base,'--format=%H','--','docs/todo/SPN-160.md'),'');
assert.equal(git('log',`${base}..${head}`,'--diff-filter=A','--format=%H','--','docs/todo/SPN-160.md'),head);
assert.match(readFileSync('docs/todo/SPN-157.md','utf8'),/depends_on: \[SPN-160\]/);
assert.match(readFileSync('docs/todo/SPN-098.md','utf8'),/depends_on: \[SPN-157\]/);
console.log(JSON.stringify({head,base,files:files.length,localLinksWithAnchorsChecked:links,grooming:after.grooming,nextId:after.next_id}));
