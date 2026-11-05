import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const dir of ['src','scripts','test']) for(const file of readdirSync(dir).filter(f=>/\.(mjs|js)$/.test(f))) execFileSync(process.execPath,['--check',dir+'/'+file],{stdio:'inherit'});
console.log('All JavaScript syntax checks passed.');
