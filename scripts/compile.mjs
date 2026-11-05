import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
export async function compileHtml(staticMode=false,apiBase='') {
  if(apiBase){const url=new URL(apiBase);if(url.protocol!=='https:'||url.origin!==apiBase||url.username||url.password)throw new Error('META_BACKEND_URL must be an HTTPS origin with no path, trailing slash, or credentials.');}
  const [html, css, js, diagram, history, presets] = await Promise.all(['index.html', 'style.css', 'app.js', 'diagram.mjs', 'history.mjs', 'presets.mjs'].map(p => readFile(resolve(root, 'src', p), 'utf8')));
  return html.replace('/* APP_STYLE */', () => css).replace('/* APP_SCRIPT */', () => ('const STATIC_MODE='+JSON.stringify(staticMode)+';const PUBLIC_API_BASE='+JSON.stringify(apiBase)+';\n'+diagram.replace(/^export /gm,'')+'\n'+history.replace(/^export /gm,'')+'\n'+presets.replace(/^export /gm,'')+'\n'+js).replace(/<\/script/gi, '<\\/script'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = await compileHtml();
  const modules = await Promise.all(['model.mjs', 'simulator.mjs', 'meta.mjs', 'export.mjs', 'diagram.mjs', 'examples.mjs', 'photos.mjs', 'inputs.mjs', 'presets.mjs', 'demos.mjs', 'demo-assets.mjs', 'diagnostics.mjs', 'handler.mjs'].map(p => readFile(resolve(root, 'src', p), 'utf8')));
  const joined = modules.map(s => s.replace(/^import .*?;\s*$/gm, '').replace(/^export /gm, '')).join('\n');
  const worker = `${joined}\nconst APP_HTML = ${JSON.stringify(html)};\nexport default { fetch(request, env, ctx) { return handlePublicRequest(request, env, ctx, APP_HTML); } };\n`;
  await mkdir(resolve(root, 'worker'), { recursive: true });
  await writeFile(resolve(root, 'worker/index.js'), worker);
  console.log('Compiled dependency-free application and shared simulator.');
}
