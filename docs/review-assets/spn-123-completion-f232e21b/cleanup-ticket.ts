import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,readlinkSync,existsSync,copyFileSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const repo='/Users/mxbaylee/projects/spinel',work=repo+'-spn-123-production',root='/tmp/spn123-completion-f232e21b',source='f232e21b4910afe6209a22d8d78516c598eba1a5',merged='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d';
mkdirSync(root,{recursive:true});const commands:any[]=[];const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function run(argv:string[],allow:number[]=[0]){const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,encoding:'utf8',maxBuffer:64*1024*1024});commands.push({at:new Date().toISOString(),argv,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});writeFileSync(join(root,'cleanup-commands.json'),JSON.stringify(commands,null,2)+'\n');assert.ok(allow.includes(r.status??-1),`${argv.join(' ')} failed ${r.status}`);return r.stdout;}
const git=(...args:string[])=>run(['git',...args]);const save=(name:string,value:any)=>writeFileSync(join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
assert.equal(git('rev-parse','main').trim(),merged);assert.equal(git('status','--porcelain=v1'),'');
const pr=JSON.parse(run(['gh','api','repos/mxbaylee/spinel/pulls/220']));save('merged-pr-before-cleanup.json',pr);assert.equal(pr.merged,true);assert.equal(pr.merge_commit_sha,merged);assert.equal(pr.head.sha,source);
const open=JSON.parse(run(['gh','api','--paginate','--slurp','repos/mxbaylee/spinel/pulls?state=open&per_page=100']));save('open-prs-before-cleanup.json',open);
const refs=git('for-each-ref','--format=%(refname) %(objectname)').trim().split('\n').map(l=>{const[ref,sha]=l.split(' ');return{ref,sha};}).filter(r=>/spn-?123/i.test(r.ref));save('refs-before-cleanup.json',refs);
const local=refs.filter(r=>r.ref.startsWith('refs/heads/')),tracking=refs.filter(r=>r.ref.startsWith('refs/remotes/'));
assert.deepEqual(local.map(r=>r.ref).sort(),['refs/heads/codex/spn-123-operation-diagnostics','refs/heads/codex/spn-123-production-integration']);
const names=new Set([...local,...tracking].map(r=>r.ref.replace(/^refs\/heads\/|^refs\/remotes\/origin\//,'')));
for(const p of open.flat())assert.ok(!names.has(p.head.ref)&&!names.has(p.base.ref),'Active PR owner '+p.number);
const remote=git('ls-remote','--heads','origin','*123*');save('remote-heads-before.txt',remote);assert.equal(remote.trim(),'aeee60266b505b1ac6f928c4725639d90c768073\trefs/heads/codex/spn-123-production-integration');
const tags=git('ls-remote','--tags','origin','*spn-123*');save('remote-tags-before.txt',tags);assert.ok(tags.includes('a44822ab287869e545fe005dfb2f62d02ef7f527\trefs/tags/archive/spn-123-validation-f232e21b-20261114'));
for(const r of [...local,...tracking])git('merge-base','--is-ancestor',r.sha,source);
save('worktrees-before.txt',git('worktree','list','--porcelain'));
const status=run(['git','-C',work,'status','--porcelain=v1','--untracked-files=all','--ignored=matching']);save('production-status-before.txt',status);assert.ok(status.split('\n').filter(Boolean).every(l=>l.startsWith('!! ')));
const copies:any[]=[];function copy(dir:string,dest:string){for(const n of readdirSync(dir)){const p=join(dir,n),to=join(dest,n),s=lstatSync(p);if(s.isDirectory()){mkdirSync(to,{recursive:true});copy(p,to);}else if(s.isFile()){mkdirSync(dirname(to),{recursive:true});const b=readFileSync(p);copyFileSync(p,to);copies.push({original:p,path:relative(root,to),bytes:b.length,sha256:hash(b)});}else throw Error('Unexpected admin symlink '+p);}}
for(const name of ['spinel-spn-123','spinel-spn-123-production'])copy(join(repo,'.git/worktrees',name),join(root,'administrative-before',name));
for(const name of ['install-resource-abort.log','integrated-native-controls.log']){const p=join(work,'docs/implementation/evidence/SPN-123-null-loader',name),b=readFileSync(p),to=join(root,'ignored-evidence',name);mkdirSync(dirname(to),{recursive:true});writeFileSync(to,b);copies.push({original:p,path:relative(root,to),bytes:b.length,sha256:hash(b)});}
const missing=join(repo,'.git/worktrees/spinel-spn-123'),missingHead='54307c19c075c5dd67a8012341cc7cee716a09a3';
assert.ok(!existsSync(repo+'-spn-123'));assert.equal(readFileSync(join(missing,'HEAD'),'utf8').trim(),'ref: refs/heads/codex/spn-123-operation-diagnostics');
save('missing-index-staged.patch',run(['git','--git-dir='+missing,'--work-tree='+repo+'-spn-123','diff','--cached','--binary',missingHead]));
save('missing-index-entries.txt',run(['git','--git-dir='+missing,'ls-files','--stage']));
const missingIndex=hash(readFileSync(join(missing,'index')));
const preserved={copies,privateDependencyDirectory:{path:work+'/node_modules',type:lstatSync(work+'/node_modules').isDirectory()?'directory':'other',action:'Retained in place; no install, traversal, cache change or deletion'},playwrightReport:{path:work+'/playwright-report',entries:readdirSync(work+'/playwright-report'),action:'Retained in place'},missingWorktree:'Missing before cleanup; no nonexistent worktree content recovery claimed; full remaining administration/index/staged patch preserved',allHeadsReachableFromPublishedValidationArchive:true};save('preservation-before.json',preserved);
// Recheck current ownership/head immediately before the guarded mutations.
const openFresh=JSON.parse(run(['gh','api','--paginate','--slurp','repos/mxbaylee/spinel/pulls?state=open&per_page=100']));save('open-prs-at-cleanup.json',openFresh);for(const p of openFresh.flat())assert.ok(!names.has(p.head.ref)&&!names.has(p.base.ref));
assert.equal(git('ls-remote','--heads','origin','refs/heads/codex/spn-123-production-integration'),remote);
git('push','--force-with-lease=refs/heads/codex/spn-123-production-integration:aeee60266b505b1ac6f928c4725639d90c768073','origin',':refs/heads/codex/spn-123-production-integration');
run(['git','-C',work,'switch','--detach',source]);
run(['git','--git-dir='+missing,'update-ref','--no-deref','HEAD',missingHead,missingHead]);
for(const r of local)git('update-ref','-d',r.ref,r.sha);
for(const r of tracking){const current=run(['git','rev-parse','--verify',r.ref],[0,128]).trim();if(current){assert.equal(current,r.sha);git('update-ref','-d',r.ref,r.sha);}}
assert.equal(hash(readFileSync(join(missing,'index'))),missingIndex);
assert.equal(run(['git','-C',work,'status','--porcelain=v1','--untracked-files=all','--ignored=matching']),status);
assert.equal(git('ls-remote','--heads','origin','*123*'),'');assert.equal(git('ls-remote','--tags','origin','*spn-123*'),tags);
const after=git('for-each-ref','--format=%(refname) %(objectname)').split('\n').filter(l=>/spn-?123/i.test(l));assert.ok(after.every(l=>l.startsWith('refs/tags/')));save('refs-after-cleanup.json',after);save('worktrees-after.txt',git('worktree','list','--porcelain'));
for(const name of ['spinel-spn-123','spinel-spn-123-production'])copy(join(repo,'.git/worktrees',name),join(root,'administrative-after',name));
save('preservation-all-bindings.json',copies);
assert.equal(git('rev-parse','main').trim(),merged);assert.equal(git('status','--porcelain=v1'),'');
const receipt={at:new Date().toISOString(),complete:true,source,merged,deletedLocalBranches:local,deletedRemoteBranch:{ref:'refs/heads/codex/spn-123-production-integration',sha:'aeee60266b505b1ac6f928c4725639d90c768073',guard:'force-with-lease exact observed SHA'},prHeadAlreadyAbsent:true,obsoleteTracking:tracking,remainingTicketBranches:[],blockedRefs:[],detachedWorktrees:[{path:work,sha:source,exists:true},{path:repo+'-spn-123',sha:missingHead,exists:false,administrationRetained:true}],missingIndexSha256:missingIndex,activePROwnership:false,immutableRemoteTagsUnchanged:true,allUniqueCommitHeadsReachableFromPublishedValidationArchive:true,ignoredFilesAndPrivateDependenciesRetainedInPlace:true,noGlobalPruneOrClean:true,noTestsBuildsOrCICancellations:true,mainClean:true};save('cleanup-receipt.json',receipt);console.log(JSON.stringify(receipt));
