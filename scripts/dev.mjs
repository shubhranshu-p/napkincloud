import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handlePublicRequest } from '../src/handler.mjs';
import { compileHtml } from './compile.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
function localEnv() {
  const values = { ...process.env };
  try {
    for (const line of readFileSync(root + '/.env', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  return values;
}
const port = Number(localEnv().PORT || 8787);
const server = http.createServer(async (req, res) => {
  try {
    let size = 0; const parts = [];
    for await (const part of req) { size += part.length; if (size > 6000000) { res.writeHead(413); res.end('Request too large'); return; } parts.push(part); }
    const abort = new AbortController();
    res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(parts), signal:abort.signal });
    const html = req.url === '/' ? await compileHtml() : '';
    const response = await handlePublicRequest(request, localEnv(), { waitUntil: promise => promise.catch(() => {}) }, html);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
    res.end();
  } catch { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Local server error. Check the project configuration.' })); }
});
server.requestTimeout = 360000;
server.listen(port, '127.0.0.1', () => console.log(`NapkinCloud is running at http://localhost:${port}\nConfiguration is loaded from .env on each request. Ctrl+C to stop.`));
