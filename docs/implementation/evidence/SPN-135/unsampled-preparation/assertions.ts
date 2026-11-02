import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const ts=createRequire('/Users/mxbaylee/projects/spinel/package.json')('typescript-api');
const root='/tmp/spn135-unsampled-runtime';
const name='e2e/doc-responsiveness.spec.ts';
const original=execFileSync('git',['show','HEAD:'+name],{cwd:root,encoding:'utf8'});
const candidate=fs.readFileSync(root+'/'+name,'utf8');
function assertions(text:string) {
 const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
 const calls:string[]=[];
 function visit(node:any) {
  if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==='expect') {
   let ancestor=node;
   while(ancestor.parent&&!ts.isExpressionStatement(ancestor.parent)) ancestor=ancestor.parent;
   calls.push(ancestor.getText(source).replace(/\s+/g,' '));
  }
  ts.forEachChild(node,visit);
 }
 visit(source);return calls;
}
const before=assertions(original),after=assertions(candidate), remaining=[...after];
for(const assertion of before){const index=remaining.indexOf(assertion);assert.ok(index>=0,'Original assertion removed or changed: '+assertion);remaining.splice(index,1);}
assert.ok(!candidate.includes("cdp.send('Profiler."));
assert.match(candidate,/profiled = false/);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const result={originalAssertions:before.length,candidateAssertions:after.length,allOriginalAssertionsPreserved:true,noProfilerCommands:true,originalSha256:hash(original),candidateSha256:hash(candidate)};
fs.writeFileSync('/tmp/spn135-unsampled-assertions.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
