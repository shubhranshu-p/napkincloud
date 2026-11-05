import {cp,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(process.argv[2]||join(root,'releases','napkincloud'));
if(target===root||root.startsWith(target+'/'))throw new Error('Choose a separate release folder.');
await mkdir(target,{recursive:true});
if((await readdir(target)).length)throw new Error('Release target must be empty; preserve the previous release.');
const files=['src','test','scripts','assets','Demo Image','docs','.github','.env.example','.gitignore','package.json','README.md','LICENSE','SECURITY.md','CONTRIBUTING.md','DESIGN-SOURCES.md','wrangler.jsonc','Start NapkinCloud.command','Open Demo Images.command'];
for(const name of files)await cp(join(root,name),join(target,name),{recursive:true});
await writeFile(join(target,'RELEASE.json'),JSON.stringify({name:'NapkinCloud',version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,preparedAt:new Date().toISOString(),credentialsIncluded:false,historyIncluded:false},null,2)+'\n');
async function inspect(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),name=relative(target,path);if(entry.isSymbolicLink())throw new Error('Unexpected symlink: '+name);if(['.git','.local','.openai','.codex','.agents','node_modules'].includes(entry.name)||entry.name==='.env'||entry.name.startsWith('.env.')&&entry.name!=='.env.example'||entry.name==='.dev.vars')throw new Error('Private file in release: '+name);if(entry.isDirectory())await inspect(path);}}
await inspect(target);console.log('Prepared clean source release: '+target);
