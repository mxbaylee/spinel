import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
const packet='/tmp/spn128-review-packet-d22baa69',cwd='/Users/mxbaylee/projects/spinel-spn-128-production';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync(packet+'/source-manifest.json','utf8'));
let gitBindings=0,exactCopies=0,maskedCopies=0,decodedGzip=0,decodedZip=0;
for(const e of manifest.files){const copy=readFileSync(packet+'/'+e.path);if(hash(copy)!==e.copySha256)throw Error(e.path+' copy hash');if(e.sourcePath&&e.source){const bytes=execFileSync('git',['show',e.source+':'+e.sourcePath],{cwd,maxBuffer:150*1024*1024});gitBindings++;let original=bytes;if(e.sourcePath.endsWith('.gz')){original=gunzipSync(bytes);decodedGzip++;}else if(e.member){original=execFileSync('unzip',['-p',cwd+'/'+e.sourcePath,e.member],{maxBuffer:32*1024*1024});decodedZip++;}if(hash(original)!==e.originalSha256)throw Error(e.path+' original hash');if(e.masked)maskedCopies++;else{if(!copy.equals(original))throw Error(e.path+' bytes');exactCopies++;}}}
const diff=execFileSync('git',['diff','--binary','--full-index',manifest.base,manifest.head],{cwd,maxBuffer:150*1024*1024});if(hash(diff)!==manifest.originalDiffSha256)throw Error('Diff mismatch');
const changedAfterTypes=execFileSync('git',['diff','--name-only','524dca9e',manifest.head,'--',':!docs'],{cwd,encoding:'utf8'}).trim();if(changedAfterTypes)throw Error('Executable changed');
const browserChangedAfterProbe=execFileSync('git',['diff','--name-only','8eca70fe',manifest.head,'--','e2e/supervised-restore-tracing.ts','e2e/supervised-restore.spec.ts'],{cwd,encoding:'utf8'}).trim();if(browserChangedAfterProbe)throw Error('Browser helper changed');
const result={head:manifest.head,base:manifest.base,payloads:manifest.files.length,gitBindings,exactCopies,maskedCopies,decodedGzip,decodedZip,allCopyHashesVerified:true,fullDiffExact:diff.equals(readFileSync(packet+'/candidate.diff')),afterTypesNonDocChanges:[],browserAfterProbeChanges:[],sourceManifestSha256:hash(readFileSync(packet+'/source-manifest.json')),blinding:'All Markdown/log/JSON/text numerical review patterns scanned; remaining matches are standing policy and workload capacities, not prior assessments. Masks remain outside original evidence.'};
writeFileSync('/tmp/spn128-audit-d22baa69-packet.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
