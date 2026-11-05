import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root='/Users/mxbaylee/projects/spinel-spn-141';
const head='4e593fbaf9ea89585920053b9415f9a8eac0944f',base='2f442317dd2e1c188ae4a810ac094fd1162a4a2a';
const git=(...args:string[])=>execFileSync('git',args,{cwd:root});
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const dir=root+'/docs/implementation/evidence/SPN-141-after144';
const m=JSON.parse(readFileSync(dir+'/local.json','utf8'));
assert.equal(git('rev-parse','HEAD').toString().trim(),head);
assert.equal(git('rev-parse','HEAD^{tree}').toString().trim(),'a2b37aa82336224ac40e92f7364e52ccebfb6d74');
assert.equal(git('status','--porcelain').toString(),'');git('merge-base','--is-ancestor',base,head);
assert.equal(m.base,base);assert.equal(m.payloads.length,29);
const payloads=[]; const raws=new Map<string,Buffer>();
for(const p of m.payloads){const stored=readFileSync(dir+'/'+p.file);const raw=gunzipSync(stored);assert.equal(stored.length,p.storedBytes,p.file);assert.equal(hash(stored),p.storedSha256,p.file);assert.equal(raw.length,p.rawBytes,p.file);assert.equal(hash(raw),p.rawSha256,p.file);raws.set(p.file,raw);payloads.push({file:p.file,storedBytes:stored.length,rawBytes:raw.length,verified:true});}
const files=Object.keys(m.sourceFiles).sort();
for(const f of files){assert.equal(hash(readFileSync(root+'/'+f)),m.sourceFiles[f]);for(const ref of [m.previousSource,'c4e64fa110a57d70fb682649d7f4d45ca3d20951'])assert.deepEqual(git('show',ref+':'+f),readFileSync(root+'/'+f),ref+':'+f);}
assert.deepEqual(git('diff','--name-only',base,head).toString().trim().split('\n').filter(f=>!f.startsWith('docs/')).sort(),files);
const ledger=JSON.parse(readFileSync(root+'/docs/todo/backlog.json','utf8'));const old=JSON.parse(git('show',base+':docs/todo/backlog.json').toString());
assert.equal(ledger.next_id,147);assert.equal(ledger.grooming.last,old.grooming.last);assert.deepEqual(ledger.grooming.completed_since,[...old.grooming.completed_since,'SPN-141']);assert.equal(ledger.grooming.completed_since.length,21);
assert.equal(readdirSync(root+'/docs/todo').filter(f=>/^SPN-\d+\.md$/.test(f)).length,22);
for(const t of ['145','146']){for(const kind of ['todo','implementation']){const f='docs/'+kind+'/SPN-'+t+'.md';assert.deepEqual(readFileSync(root+'/'+f),git('show',base+':'+f));}}
assert.match(raws.get('tests.log.gz')!.toString(),/tests 46/);assert.match(raws.get('tests.log.gz')!.toString(),/pass 46/);assert.match(raws.get('tests.log.gz')!.toString(),/fail 0/);
assert.match(raws.get('pr.log.gz')!.toString(),/error/i);assert.match(raws.get('pr-final.log.gz')!.toString(),/pull request ok/);
const watchdogs=['tests','types','lint'].map(n=>JSON.parse(raws.get(n+'-watchdog.json.gz')!.toString()));
const out={status:'passed',head,base,tree:'a2b37aa82336224ac40e92f7364e52ccebfb6d74',payloads,sourceFiles:m.sourceFiles,sourceEqualTo:[m.previousSource,'c4e64fa110a57d70fb682649d7f4d45ca3d20951'],onlyNonDocumentationFiles:files,bookkeeping:m.bookkeeping,checks:m.checks,watchdogs,hostedAcceptance:'Pending on this source; no prior source acceptance credited.'};
writeFileSync('/tmp/spn141-review-4e593fba-proof-a.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({status:'passed',payloads:payloads.length,sourceFiles:files.length,head,bookkeeping:m.bookkeeping}));
