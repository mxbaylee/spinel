/** Prepare byte-exact review preservation only; no Git writes, refs, push or metadata. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const staging='/tmp/spn128-preservation-d22baa69', input=JSON.parse(readFileSync(join(staging,'inputs.json'),'utf8'));
const source='d22baa6997e27c123ef351a8f5321089cc9e345b',base='8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d',packet='/tmp/spn128-review-packet-d22baa69';
const root=join(staging,'archive'),cwd='/Users/mxbaylee/projects/spinel-spn-128-production';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
if(input.source!==source||input.base!==base)throw Error('Source binding mismatch');
if(input.reviews.length!==2||input.reviews.some((r:{report:string|null;source:string;originals:string[]})=>!r.report||r.source!==source||!r.originals.length))throw Error('Await both exact-head original reports and raw provenance');
if(!input.rootPacketAudit||!input.rootSourceAudit||!input.rootReadBothReports)throw Error('Await root audits and full report reading');
if(execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim()!==source||execFileSync('git',['status','--porcelain'],{cwd,encoding:'utf8'}).trim())throw Error('Candidate changed');
if(existsSync(root))throw Error('Archive stage already exists; preserve any previous preparation');
mkdirSync(root);const originals:object[]=[];
function copy(path:string,dest:string){const bytes=readFileSync(path);mkdirSync(dirname(join(root,dest)),{recursive:true});writeFileSync(join(root,dest),bytes);originals.push({originalPath:path,archivePath:dest,bytes:bytes.length,sha256:hash(bytes)});}
for(const r of input.reviews){copy(r.report,'reviews/'+r.report.split('/').at(-1));for(const path of r.originals)copy(path,'execution/'+r.agent+'/'+path.split('/').at(-1));}
for(const path of [input.rootPacketAudit,input.rootSourceAudit,...input.supplements])copy(path,'audit/'+path.split('/').at(-1));
for(const name of ['source-manifest.json','source-bindings.txt','review-input.md','current-pr-check.log','current-pr-check-guard.json'])copy(join(packet,name),'packet-bindings/'+name);
copy(join(staging,'stage-review-archive.ts'),'audit/stage-review-archive.ts');copy(join(staging,'inputs.json'),'audit/inputs.json');
const archive=join(root,'review-packet-d22baa69.tar.gz');
execFileSync('tar',['-czf',archive,'-C',packet,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
const verification=execFileSync('python3',['-c',`import tarfile,pathlib,hashlib,json,sys\nroot=pathlib.Path(sys.argv[2]);files={p.relative_to(root).as_posix():p for p in root.rglob('*') if p.is_file()};seen=set()\nwith tarfile.open(sys.argv[1],'r:gz') as t:\n for m in t:\n  if not m.isfile():continue\n  name=m.name.removeprefix('./');assert name in files and name not in seen;assert t.extractfile(m).read()==files[name].read_bytes();seen.add(name)\nassert seen==set(files)\nprint(json.dumps({'files':len(seen),'allMemberBytesExact':True,'sha256':hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()}))`,archive,packet],{encoding:'utf8'}).trim();
writeFileSync(join(root,'packet-archive-verification.json'),verification+'\n');
writeFileSync(join(root,'provenance.json'),JSON.stringify({source,base,plannedDirectParent:source,exclusivePrefix:input.exclusivePrefix,reviews:input.reviews,originals,packetManifestSha256:hash(readFileSync(join(packet,'source-manifest.json'))),historicalArchiveLinks:input.historicalArchiveLinks,original628dTerminalArchive:input.original628dTerminalArchive,limits:input.limits},null,2)+'\n');
writeFileSync(join(root,'README.md'),`# 🌷 Repaired SPN-128 review evidence\n\nPrepared for an evidence-only direct child of reviewed source ${source}, actual base ${base}, exclusively ${input.exclusivePrefix}. This staging helper creates no commit or ref and does not change the candidate.\n\nThe full grade-free packet is an exact TAR. Original current reports and all original execution/provenance files are separate and byte-exact, including first failures and resource/preflight limits. Published historical archives are linked, not recursively recopied. Current reports assess the complete L recovery outcome and this repair; scores do not establish hosted acceptance.\n\nOriginal628d missed retained-cut acceptance and its actual hosted trace collision/callback postprocessing failure remain historical failures. The pre-freeze SIGKILL and observation-order findings and local type/privacy-fixture failures are preserved in the candidate. Fresh repaired-head hosted acceptance remains pending.\n\n${input.historicalArchiveLinks.map((x:string)=>'- '+x).join('\n')}\n`);
const walk=(p:string):string[]=>readdirSync(p).flatMap(n=>{const f=join(p,n);return statSync(f).isDirectory()?walk(f):[f];});
writeFileSync(join(root,'manifest.json'),JSON.stringify({source,base,files:walk(root).sort().map(p=>({path:p.slice(root.length+1),sha256:hash(readFileSync(p)),bytes:statSync(p).size}))},null,2)+'\n');
console.log(JSON.stringify({root,source,base,status:'Staged only; root audit/seal still required',manifestSha256:hash(readFileSync(join(root,'manifest.json'))),packet:JSON.parse(verification)}));
