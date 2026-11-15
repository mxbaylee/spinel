import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='/tmp/spn128-body-edit-43658181655',origin='/tmp/spn128-publication-d22baa69';
mkdirSync(join(root,'trigger-originals'),{recursive:true});
const files=['body-edit-cancel.log','body-edit-run-before-cancel.json','old-head-runs-before-publication.json','old-head-runs-after-push.json','body-publication-response.json','pr-body-publication.md','validation-push.json'];
const originals=files.map(name=>{const bytes=readFileSync(join(origin,name));writeFileSync(join(root,'trigger-originals',name),bytes,{flag:'wx'});return {original:join(origin,name),path:'trigger-originals/'+name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
writeFileSync(join(root,'trigger-bindings.json'),JSON.stringify({run:43658181655,source:'628d77987e7d9a08863465a7553a2ed82579728b',created:'2026-11-15T00:26:34Z',role:'Root-identified superseded body-edit validation; normal cancellation requested by root. Preserve raw outcomes separately; no current acceptance claim.',originals,collectorReadOnly:true},null,2)+'\n');
const latest=JSON.parse(readFileSync(join(root,'latest.json'),'utf8'));console.log(JSON.stringify(latest.jobs.filter((j:any)=>j.status!=='completed').map((j:any)=>({id:j.id,name:j.name,status:j.status}))));
