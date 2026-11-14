import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base='89e4426dfff1c3469b260305e21180ffd79fdb7f';
const head='c40de80414632db0c4cbef8a82930d20a3db910d';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('rev-parse','HEAD'),head);
assert.equal(git('status','--porcelain'),'');
git('diff','--check',base,head);
const files=git('diff','--name-only',base,head).split('\n');
let links=0;
for(const file of files.filter(f=>f.endsWith('.md'))){
  const body=readFileSync(file,'utf8');
  for(const match of body.matchAll(/\]\(([^)]+)\)/g)){
    const target=match[1];
    if(/^[a-z]+:\/\//.test(target)) continue;
    const [path,anchor]=target.split('#');
    const full=path?resolve(dirname(file),path):resolve(file);
    assert(existsSync(full),`${file}: missing ${target}`);
    if(anchor){
      const headings=[...readFileSync(full,'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(m=>m[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/\s/g,'-'));
      assert(headings.includes(decodeURIComponent(anchor)),`${file}: missing anchor ${target}`);
    }
    links++;
  }
}
const before=JSON.parse(git('show',`${base}:docs/todo/backlog.json`));
const after=JSON.parse(readFileSync('docs/todo/backlog.json','utf8'));
assert.equal(before.next_id,159);assert.equal(after.next_id,160);
assert.deepEqual(before.grooming,after.grooming);
assert.equal(git('log',base,'--format=%H','--','docs/todo/SPN-159.md'),'');
assert.equal(git('log',`${base}..${head}`,'--diff-filter=A','--format=%H','--','docs/todo/SPN-159.md'),'19337e04fad8a6b59ebb62e7fedec5243b72afd8');
const manifest=JSON.parse(readFileSync('/tmp/spn120-storybook-first-failure/manifest.json','utf8'));
console.log(JSON.stringify({head,files:files.length,localLinksWithAnchorsChecked:links,manifestKeys:Object.keys(manifest),requested:manifest.requested.length,checked:manifest.checked.length,durationMs:manifest.durationMs,reviewedAt:manifest.reviewedAt}));
