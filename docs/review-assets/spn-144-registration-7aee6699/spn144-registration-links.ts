import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const files=['docs/todo/SPN-144.md','docs/todo/SPN-141.md','docs/implementation/SPN-144.md','docs/implementation/SPN-141.md','docs/implementation/SPN-143.md'];
let links=0;
for(const file of files)for(const m of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){
 if(/^https?:/.test(m[1])){assert.ok(m[1].startsWith('https://'));continue;}
 const [path,anchor]=m[1].split('#');const target=resolve(dirname(file),path||file);
 assert.ok(existsSync(target),`${file}: ${m[1]}`);
 if(anchor){const content=readFileSync(target,'utf8');const headings=Array.from(content.matchAll(/^#+ (.*)$/gm),h=>h[1].toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/\s/g,'-'));assert.ok(headings.includes(anchor),`${file}: missing ${m[1]}`);}
 links++;
}
console.log(JSON.stringify({files:files.length,relativeLinks:links,passed:true}));
