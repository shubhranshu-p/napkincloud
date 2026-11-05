import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../src/examples.mjs';
import { validateGraph, applyPatch, copy } from '../src/model.mjs';
import { simulate } from '../src/simulator.mjs';
import { exportFiles } from '../src/export.mjs';
import { handleRequest } from '../src/handler.mjs';

test('extended flow is reproducible and every request traverses the gateway and API',()=>{
 const e=EXAMPLES[0],a=simulate(e.graph,e.workload),b=simulate(e.graph,e.workload);
 assert.deepEqual(a,b);assert.equal(a.nodes.find(n=>n.id==='gateway').arrivals,a.summary.generated);
 assert.equal(a.summary.generated,a.summary.completed+a.summary.rejected+a.summary.timedOut);assert.equal(a.summary.inFlight,0);
 assert.ok(a.nodes.find(n=>n.type==='queue').arrivals>0);assert.ok(a.nodes.find(n=>n.type==='worker').arrivals>0);
});
test('read/write routes bypass cache for writes; zero-hit cache does not invent benefits',()=>{
 const e=EXAMPLES[0],graph=applyPatch(e.graph,{action:'add_cache'});
 const writes=simulate(graph,{...e.workload,readRatio:0});assert.equal(writes.summary.cacheLookups,0);assert.equal(writes.summary.cacheHits,0);assert.ok(writes.nodes.find(n=>n.type==='worker').arrivals>0);
 const misses=simulate(graph,{...e.workload,cacheHitRatio:0});assert.equal(misses.summary.cacheHits,0);assert.equal(misses.summary.passed,false);
 const warm=simulate(graph,e.workload);assert.equal(warm.summary.passed,true);assert.ok(warm.nodes.find(n=>n.type==='postgres').arrivals<misses.nodes.find(n=>n.type==='postgres').arrivals);
});
test('flow validation rejects cycles, unconnected stages, invalid routes, and write caching',()=>{
 const cycle=copy(EXAMPLES[0].graph);cycle.edges.push({from:'reads',to:'api',when:'read'});assert.throws(()=>validateGraph(cycle),/acyclic/);
 const orphan=copy(EXAMPLES[0].graph);orphan.nodes.push({...orphan.nodes[2],id:'orphan'});assert.throws(()=>validateGraph(orphan),/belong/);
 const bad=applyPatch(EXAMPLES[0].graph,{action:'add_cache'});bad.edges.push({from:'api',to:'cache',when:'write'});assert.throws(()=>validateGraph(bad),/bypass/);
});
test('extended exports recompute real simulation evidence and do not pretend to deploy the topology',async()=>{
 const e=EXAMPLES[0],r=await exportFiles({graph:e.graph,workload:e.workload,patch:{action:'add_cache'}});
 assert.equal(r.evidence.verification.templateCompilation,false);assert.equal(r.evidence.verification.benchmark,false);assert.ok(r.files['before.json']);assert.ok(r.files['after.json']);assert.ok(!r.files['compose.yaml']);assert.equal(JSON.parse(r.files['evidence.json']).selected.summary.passed,true);
});
test('scenario image endpoint returns original diagrams and never injects unescaped labels',async()=>{
 const e=EXAMPLES[0],response=await handleRequest(new Request('https://app.example'+e.sketch));assert.equal(response.status,200);assert.match(await response.text(),/API gateway/);
 const graph=copy(e.graph);graph.nodes[0].label='<script>bad()</script>';
 const {architectureSvg}=await import('../src/diagram.mjs');const svg=architectureSvg(graph);assert.ok(!svg.includes('<script>'));assert.match(svg,/&lt;script&gt;/);
});

test('combined generation preserves a failed attempt, generates its image, and never calls the image provider before analysis',async()=>{
 const original=globalThis.fetch;let turn=0,analysisDone=false;
 try{globalThis.fetch=async(url,request)=>{
   const body=JSON.parse(request.body);
   if(String(url).endsWith('/responses')){assert.ok(analysisDone);assert.equal(body.model,'muse-image-1.0');return new Response(JSON.stringify({output:[{type:'image_generation_call',result:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxWQAAAAASUVORK5CYII='}]}));}
   assert.equal(body.model,'muse-spark-1.3');assert.equal(body.reasoning_effort,'high');turn++;const fn=turn===1?{name:'evaluate_architecture',arguments:JSON.stringify({action:'add_cache',replicas:null,label:'Test cache'})}:{name:'finish_evaluation',arguments:JSON.stringify({candidate_id:'none',explanation:'Write pressure remains above the database capacity.'})};if(turn===2)analysisDone=true;
   return new Response(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'c'+turn,type:'function',function:fn}]}}]}));
 };
 const e=structuredClone(EXAMPLES.find(e=>e.id==='concert'));e.graph.nodes.find(n=>n.type==='postgres').capacity=5;const response=await handleRequest(new Request('https://app.example/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...e,model:'untrusted-model'})}),{MODEL_API_KEY:'fixture-key'});
 const events=(await response.text()).trim().split('\n').map(JSON.parse),last=events.at(-1);assert.equal(last.type,'complete');assert.equal(last.result.selected,null);assert.equal(last.result.displayedCandidate.result.summary.passed,false);assert.match(last.result.image,/^data:image\/png/);assert.ok(events.some(e=>e.type==='analysis'));
 }finally{globalThis.fetch=original;}
});
test('combined generation keeps numerical findings when image generation fails',async()=>{
 const original=globalThis.fetch;let turn=0;
 try{globalThis.fetch=async(url)=>{if(String(url).endsWith('/responses'))return new Response('provider private diagnostics',{status:403});turn++;const fn=turn===1?{name:'evaluate_architecture',arguments:JSON.stringify({action:'add_cache',replicas:null,label:'Read cache'})}:{name:'finish_evaluation',arguments:JSON.stringify({candidate_id:'candidate_1',explanation:'The configured workload passed.'})};return new Response(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'c'+turn,type:'function',function:fn}]}}]}));};
 const e=EXAMPLES[0],response=await handleRequest(new Request('https://app.example/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(e)}),{MODEL_API_KEY:'fixture-key'});const last=(await response.text()).trim().split('\n').map(JSON.parse).at(-1);assert.equal(last.type,'complete');assert.equal(last.result.selected.result.summary.passed,true);assert.equal(last.result.image,null);assert.match(last.result.imageError,/403/);assert.ok(!last.result.imageError.includes('private diagnostics'));
 }finally{globalThis.fetch=original;}
});

test('cancelling combined generation aborts the active image request and prevents further provider calls',async()=>{
 const original=globalThis.fetch;let turn=0,imageAborted=false,calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;if(String(url).endsWith('/responses'))return new Promise((resolve,reject)=>{const stop=()=>{imageAborted=true;reject(new DOMException('Cancelled','AbortError'));};if(options.signal.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});});turn++;const fn=turn===1?{name:'evaluate_architecture',arguments:JSON.stringify({action:'add_cache',replicas:null,label:'Read cache'})}:{name:'finish_evaluation',arguments:JSON.stringify({candidate_id:'candidate_1',explanation:'Configured test passed.'})};return new Response(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'c'+turn,type:'function',function:fn}]}}]}));};
 const response=await handleRequest(new Request('https://app.example/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(EXAMPLES[0])}),{MODEL_API_KEY:'fixture-key'});const reader=response.body.getReader();let text='';while(!text.includes('Rendering the tested architecture image')){const chunk=await reader.read();if(chunk.done)throw new Error('Stream ended too early');text+=new TextDecoder().decode(chunk.value);}await reader.cancel();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(imageAborted,true);assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});

test('cache-hit completion cannot silently skip downstream processing',()=>{const graph=applyPatch(EXAMPLES[0].graph,{action:'add_cache'});const edge=graph.edges.find(e=>e.from==='cache');edge.to='worker';assert.throws(()=>validateGraph(graph),/Post-cache processing/);});
