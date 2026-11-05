import { VERSION, DEFAULT_GRAPH, DEFAULT_WORKLOAD, validateGraph, validateWorkload, copy } from './model.mjs';
import { simulate, evaluatePatch, stressSuite } from './simulator.mjs';
import { configured, metaChat, compileSketch, interpretScenario, repairArchitecture, architectureImage } from './meta.mjs';
import { exportFiles, tarFiles } from './export.mjs';
import { EXAMPLES, sketchSvg } from './examples.mjs';
import { PHOTO_ASSETS } from './photos.mjs';
import { experimentDiagnosis } from './diagnostics.mjs';
import { INPUT_ASSETS } from './inputs.mjs';
import { DEMO_IMAGES } from './demos.mjs';
import { DEMO_ASSETS } from './demo-assets.mjs';

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><pattern id="grain" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="5" cy="6" r=".6" fill="#b7b29f" opacity=".22"/></pattern><marker id="arrow" markerWidth="12" markerHeight="9" refX="10" refY="4.5" orient="auto"><path d="M0 0L10 4.5L0 9" fill="none" stroke="#6c7462" stroke-width="1.5"/></marker></defs><rect width="1000" height="1000" fill="#ece9db"/><rect width="1000" height="1000" fill="url(#grain)"/><g fill="none" stroke="#5b6451" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M73 342Q165 334 277 342L280 489Q170 497 70 487Z"/><path d="M391 343L598 338L602 491L388 487Z"/><path d="M721 364C721 330 930 330 930 364L928 470C928 505 721 505 721 470Z"/><path d="M721 364C721 399 930 399 930 364"/><path d="M282 417Q340 410 386 416" marker-end="url(#arrow)"/><path d="M602 416Q661 424 716 416" marker-end="url(#arrow)"/><path d="M124 163Q398 151 628 166" stroke="#8b917e" stroke-width="1.2"/><path d="M768 576Q821 548 842 510" marker-end="url(#arrow)"/></g><g fill="#59624f" font-family="Georgia,serif" font-style="italic"><text x="123" y="139" font-size="36" transform="rotate(-2 123 139)">the launch-day shop.</text><text x="112" y="433" font-size="31">client</text><text x="458" y="430" font-size="35">API</text><text x="751" y="444" font-size="29">postgres</text><text x="583" y="622" font-size="24" transform="rotate(3 583 622)">will this survive launch?</text><text x="99" y="794" font-size="24" fill="#8b917b">90% catalog reads. 10% stock writes.</text><text x="99" y="840" font-size="22" fill="#8b917b">one big idea, three little boxes.</text></g></svg>`;
let activeRepairCount = 0;
// Per-isolate in-memory rate limiter (60s sliding window). Reserves the maximum
// upstream attempts upfront so concurrent requests cannot overrun the budget;
// unused reservations are refunded when generation finishes. Attempts include
// failures and cancellations. Resets on restart, is not shared across isolates,
// and tracks call counts only. This is not a guaranteed dollar spending cap.
const recentModelCalls = [];
const recentUpstreamCalls = [];
const UPSTREAM_LIMIT = 24, MAX_UPSTREAM_PER_ANALYSIS = 6, MAX_UPSTREAM_PER_REPAIR = 5;
const commonHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'"
};
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...commonHeaders, 'Content-Type': 'application/json; charset=utf-8' } }); }
function reserveModelRequest() {
  const now = Date.now(); while (recentModelCalls.length && recentModelCalls[0] < now - 60000) recentModelCalls.shift();
  if (recentModelCalls.length >= 8) throw new Error('The lab is limiting model requests to protect your credits. Wait a minute and retry.');
  recentModelCalls.push(now);
}
function reserveUpstreamCalls(calls) {
  const now = Date.now(); while (recentUpstreamCalls.length && recentUpstreamCalls[0].t < now - 60000) recentUpstreamCalls.shift();
  if (recentUpstreamCalls.length + calls > UPSTREAM_LIMIT) throw new Error('The lab is limiting model requests to protect your credits. Wait a minute and retry.');
  const owner = Symbol();
  for (let i = 0; i < calls; i++) recentUpstreamCalls.push({ t: now, owner });
  return owner;
}
function refundUpstreamCalls(owner, count) {
  if (!owner || count <= 0) return;
  const now = Date.now(); while (recentUpstreamCalls.length && recentUpstreamCalls[0].t < now - 60000) recentUpstreamCalls.shift();
  let n = count;
  for (let i = recentUpstreamCalls.length - 1; i >= 0 && n > 0; i--) {
    if (recentUpstreamCalls[i].owner === owner) { recentUpstreamCalls.splice(i, 1); n--; }
  }
}
// Optional exact-origin bridge from the public Pages frontend to a hosted backend.
export async function handlePublicRequest(request,env={},ctx={},html='') {
  const origin=request.headers.get('Origin');
  const allowed=origin&&origin===env.PUBLIC_APP_ORIGIN;
  if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}:{}});
  const response=await handleRequest(request,env,ctx,html);
  if(!allowed)return response;
  const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
  return new Response(response.body,{status:response.status,headers});
}
export async function handleRequest(request, env = {}, ctx = {}, html = '') {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/') return new Response(html, { headers: { ...commonHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
    if (request.method === 'GET' && url.pathname === '/api/examples') return json({ examples: copy(EXAMPLES) });
    if (request.method === 'GET' && url.pathname === '/api/demo-images') return json({ demos: copy(DEMO_IMAGES) });
    if (request.method === 'GET' && url.pathname.startsWith('/demo-images/')) {
      const asset=DEMO_ASSETS[url.pathname.slice(13)];
      return asset?new Response(Uint8Array.from(atob(asset),c=>c.charCodeAt(0)),{headers:{...commonHeaders,'Content-Type':'image/png','Cache-Control':'public, max-age=3600'}}):json({error:'Demo image not found.'},404);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const asset={...PHOTO_ASSETS,...INPUT_ASSETS}[url.pathname.slice(8)];
      if (!asset) return json({error:'Image not found.'},404);
      return new Response(Uint8Array.from(atob(asset.base64), c=>c.charCodeAt(0)), {headers:{...commonHeaders,'Cache-Control':'public, max-age=86400','Content-Type':asset.type}});
    }
    if (request.method === 'GET' && /^\/examples\/[a-z]+\.svg$/.test(url.pathname)) {
      const example=EXAMPLES.find(e=>e.id===url.pathname.split('/').pop().slice(0,-4));
      return example ? new Response(sketchSvg(example.graph),{headers:{...commonHeaders,'Content-Type':'image/svg+xml'}}) : json({error:'Example not found.'},404);
    }
    if (request.method === 'GET' && url.pathname === '/sample.svg') return new Response(SAMPLE_SVG, { headers: { ...commonHeaders, 'Content-Type': 'image/svg+xml' } });
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') return json({ version: VERSION, graph: copy(DEFAULT_GRAPH), workload: copy(DEFAULT_WORKLOAD), connected: configured(env), parseModel: env.META_PARSE_MODEL || 'muse-spark-1.3', agentModel: 'muse-spark-1.3' });
    if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, version: VERSION, metaConfigured: configured(env) });
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin && origin !== env.PUBLIC_APP_ORIGIN) return json({ error: 'Cross-origin requests are not accepted.' }, 403);
    if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: 'Send application/json.' }, 415);
    if (Number(request.headers.get('Content-Length') || 0) > 6000000) return json({ error: 'Request too large.' }, 413);
    const raw = await request.text(); if (raw.length > 6000000) return json({ error: 'Request too large.' }, 413);
    const input = JSON.parse(raw);
    const paidPaths=['/api/architecture-image','/api/compile-sketch','/api/scenario','/api/repair','/api/analyze'];
    if(paidPaths.includes(url.pathname)&&env.META_ACCESS_UNTIL){
      const until=Date.parse(env.META_ACCESS_UNTIL);
      if(!Number.isFinite(until))return json({error:'Paid features are unavailable because the server judging-window setting is invalid. Contact the project owner.'},503);
      if(Date.now()>until)return json({error:'The hosted AI judging window has ended. Local simulation and downloads remain available. Contact the project owner to extend AI access.'},503);
    }
    if (url.pathname === '/api/validate-graph') return json({ graph: validateGraph(input.graph) });
    if (url.pathname === '/api/simulate') return json(simulate(input.graph, input.workload));
    if (url.pathname === '/api/retest') {
      const graph = validateGraph(input.graph), workload = validateWorkload(input.workload);
      const candidate = { id: 'retested_candidate', label: 'Previous repair · new workload', ...evaluatePatch(graph, workload, input.patch) };
      return json({ candidate, stress: stressSuite(candidate.graph, workload) });
    }
    if (url.pathname === '/api/compare') {
      const graph = validateGraph(input.graph), workload = validateWorkload(input.workload);
      const patches = [{ action: 'scale_api', replicas: 3 }];
      if (!graph.nodes.some(n => n.type === 'redis')) patches.push({ action: 'add_cache' });
      const candidates = patches.map((p, i) => ({ id: `local_${i + 1}`, label: p.action === 'add_cache' ? 'Add a read-through cache' : 'Scale API to 3 replicas', ...evaluatePatch(graph, workload, p) }));
      const selected = candidates.filter(c => c.result.summary.passed).sort((a, b) => b.result.summary.successRate - a.result.summary.successRate || a.result.summary.p95Ms - b.result.summary.p95Ms)[0] || null;
      return json({ mode: 'local', baseline: simulate(graph, workload), candidates, selected, stress: selected ? stressSuite(selected.graph, workload) : [] });
    }
    if (url.pathname === '/api/architecture-image') { reserveModelRequest(); reserveUpstreamCalls(1); return json(await architectureImage(env,input,request.signal)); }
    if (url.pathname === '/api/compile-sketch') { reserveModelRequest(); reserveUpstreamCalls(1); return json(await compileSketch(env, input.image)); }
    if (url.pathname === '/api/scenario') { reserveModelRequest(); reserveUpstreamCalls(1); return json(await interpretScenario(env, input.text, input.workload)); }
    if (url.pathname === '/api/repair'||url.pathname==='/api/analyze') {
      if (!configured(env)) return json({ error: 'Meta is not connected. Set MODEL_API_KEY on the server.' }, 503);
      validateGraph(input.graph); validateWorkload(input.workload);
      if (activeRepairCount >= 1) return json({ error: 'Another experiment is running. Wait for it to finish.' }, 429);
      reserveModelRequest(); const upstreamMax=url.pathname==='/api/analyze'?MAX_UPSTREAM_PER_ANALYSIS:MAX_UPSTREAM_PER_REPAIR; const upstreamOwner=reserveUpstreamCalls(upstreamMax); let upstreamAttempts=0;
      activeRepairCount++; const encoder = new TextEncoder(); let cancelled = false; const abort = new AbortController();
      const onAbort = () => abort.abort(); request.signal.addEventListener('abort', onAbort, {once:true});if(request.signal.aborted)abort.abort();
      const countingChat = async (e, b, s) => { upstreamAttempts++; return metaChat(e, b, s); };
      const stream = new ReadableStream({
        start(controller) {
          const emit = event => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
          const started=performance.now();let phase='reasoning';
          const done = (async()=>{
            if(url.pathname==='/api/repair'){await repairArchitecture(env,input,emit,countingChat,abort.signal);return;}
            const analysis=await repairArchitecture(env,input,event=>{if(event.type!=='complete')emit(event);},countingChat,abort.signal);
            abort.signal.throwIfAborted();
            const displayedCandidate=analysis.selected||[...analysis.candidates,...(analysis.escalations||[])].sort((a,b)=>b.result.summary.successRate-a.result.summary.successRate||(a.result.summary.p95Ms??Infinity)-(b.result.summary.p95Ms??Infinity))[0]||null;
            const reasoningMs=Math.round(performance.now()-started),diagnosis=experimentDiagnosis(analysis,displayedCandidate);emit({type:'analysis',result:{...analysis,displayedCandidate,diagnosis,timings:{reasoningMs,totalMs:reasoningMs}}});
            let image=null,imageError=null,imageMs=0;
            if(displayedCandidate){phase='image';const imageStarted=performance.now();emit({type:'status',message:'Rendering the tested architecture image…'});try{upstreamAttempts++;image=(await architectureImage(env,{graph:displayedCandidate.result.graph},abort.signal)).image;}catch(error){if(abort.signal.aborted)throw error;imageError=error.message;}imageMs=Math.round(performance.now()-imageStarted);}
            abort.signal.throwIfAborted();emit({type:'complete',result:{...analysis,displayedCandidate,image,imageError,diagnosis,timings:{reasoningMs,imageMs,totalMs:Math.round(performance.now()-started)},displayStress:displayedCandidate?stressSuite(displayedCandidate.graph,input.workload):[]}});
          })().catch(error => {if(!abort.signal.aborted)emit({ type: 'error', message: error.message,stage:phase,timings:{totalMs:Math.round(performance.now()-started)} });}).finally(() => { refundUpstreamCalls(upstreamOwner, upstreamMax - upstreamAttempts); activeRepairCount--; request.signal.removeEventListener('abort',onAbort); if (!cancelled) controller.close(); });
          ctx.waitUntil?.(done);
        },
        cancel() { cancelled = true; abort.abort(); }
      });
      return new Response(stream, { headers: { ...commonHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' } });
    }
    if (url.pathname === '/api/export-preview') return json(await exportFiles(input));
    if (url.pathname === '/api/export') {
      const { files } = await exportFiles(input);
      return new Response(tarFiles(files), { headers: { ...commonHeaders, 'Content-Type': 'application/x-tar', 'Content-Disposition': 'attachment; filename="napkincloud-reference-stack.tar"' } });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'The request was not valid JSON. Please retry.' : error.message || 'The experiment could not complete.' }, 400);
  }
}
