import { mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileHtml } from './compile.mjs';
import { EXAMPLES } from '../src/examples.mjs';
import { DEMO_IMAGES } from '../src/demos.mjs';
import { architectureSvg } from '../src/diagram.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),target=resolve(root,'pages');
await rm(target,{recursive:true,force:true});
await mkdir(resolve(target,'examples'),{recursive:true});
await mkdir(resolve(target,'demo-images'),{recursive:true});
await writeFile(resolve(target,'index.html'),await compileHtml(true,process.env.META_BACKEND_URL||''));
await writeFile(resolve(target,'.nojekyll'),'');

for(const e of EXAMPLES)await writeFile(resolve(target,'examples',e.id+'.svg'),architectureSvg(e.graph));
for(const d of DEMO_IMAGES)await cp(resolve(root,'Demo Image',d.filename),resolve(target,'demo-images',d.id+'.png'));
console.log('Built the full-app Pages frontend. META_BACKEND_URL is required for API access; there is no local generation fallback.');
