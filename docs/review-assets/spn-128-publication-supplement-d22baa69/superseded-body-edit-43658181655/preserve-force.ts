import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='/tmp/spn128-body-edit-43658181655',origin='/tmp/spn128-publication-d22baa69';
const records=['body-edit-before-force-cancel.json','body-edit-force-cancel-response.txt'].map(name=>{const bytes=readFileSync(origin+'/'+name);writeFileSync(root+'/trigger-originals/'+name,bytes,{flag:'wx'});return {original:origin+'/'+name,path:'trigger-originals/'+name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
writeFileSync(root+'/force-cancel-bindings.json',JSON.stringify({actor:'root coordinator',collectorPerformedCancellation:false,run:43658181655,source:'628d77987e7d9a08863465a7553a2ed82579728b',reason:'Only Unit tests and Lib tests aggregate jobs remained queued after the normal cancellation; this exact superseded body-edit run contains no useful repaired-head work.',records},null,2)+'\n');
