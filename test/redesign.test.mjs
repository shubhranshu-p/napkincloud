import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, sketchSvg } from '../src/examples.mjs';
import { PHOTO_ASSETS } from '../src/photos.mjs';
import { architectureSvg } from '../src/diagram.mjs';
import { validateGraph, applyPatch } from '../src/model.mjs';
import { simulate } from '../src/simulator.mjs';
import { handleRequest } from '../src/handler.mjs';
import { metaChat, repairArchitecture, architectureImage } from '../src/meta.mjs';

test('all three Relay examples have validated extended flows and matching technical diagrams', async () => {
  assert.equal(EXAMPLES.length, 3);
  for (const e of EXAMPLES) {
    validateGraph(e.graph);
    const svg=sketchSvg(e.graph);
    for (const n of e.graph.nodes) assert.ok(svg.includes(n.label));
    assert.ok(e.graph.nodes.length>=7);assert.match(svg,/Writes/);assert.match(svg,/Reads/);
    const response=await handleRequest(new Request('https://lab.example'+e.sketch));
    assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/svg/);

  }
  const response=await handleRequest(new Request('https://lab.example/api/examples'));
  assert.equal((await response.json()).examples.length,3);
});
test('examples compute fresh results and caching cannot repair the write-heavy sync workload',()=>{
  for(const e of EXAMPLES){
    const before=simulate(e.graph,e.workload),after=simulate(applyPatch(e.graph,{action:'add_cache'}),e.workload);
    assert.equal(before.summary.generated,after.summary.generated);
    assert.equal(before.summary.passed,false);
    assert.equal(after.summary.passed,e.id!=='concert',e.id);
    assert.equal(before.summary.generated,before.summary.completed+before.summary.rejected+before.summary.timedOut);
  }
});
test('retesting preserves the proposed cache but reports failure for a new write-heavy workload',async()=>{
  const e=EXAMPLES[0];
  const response=await handleRequest(new Request('https://lab.example/api/retest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({graph:e.graph,workload:{...e.workload,readRatio:.2},patch:{action:'add_cache'}})}));
  const r=await response.json();assert.equal(r.candidate.graph.nodes.length,EXAMPLES[0].graph.nodes.length+1);assert.equal(r.candidate.result.summary.passed,false);
});
test('already cancelled agent never starts a billable request',async()=>{
  const abort=new AbortController();abort.abort();let called=false;
  await assert.rejects(repairArchitecture({},EXAMPLES[0],()=>{},async()=>{called=true;},abort.signal),{name:'AbortError'});
  assert.equal(called,false);
});
test('Meta failures distinguish upstream connectivity, timeout, cancellation, and credentials',async()=>{
  const original=globalThis.fetch;
  const env={MODEL_API_KEY:'never-return-this-credential'};
  try{
    globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
    await assert.rejects(metaChat(env,{}),/could not reach Meta/);
    globalThis.fetch=async()=>{throw new DOMException('expired','TimeoutError');};
    await assert.rejects(metaChat(env,{}),/took too long/);
    const abort=new AbortController();abort.abort();
    await assert.rejects(metaChat(env,{},abort.signal),{name:'AbortError'});
    globalThis.fetch=async()=>new Response('secret upstream response',{status:401});
    await assert.rejects(metaChat(env,{}),e=>e.message.includes('rejected the API key')&&!e.message.includes('never-return'));
    await assert.rejects(metaChat({},{}),/not connected/);
  }finally{globalThis.fetch=original;}
});
test('disconnecting the streamed repair aborts upstream work and releases the concurrency slot',async()=>{
  const original=globalThis.fetch;let aborted=0;
  globalThis.fetch=async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Cancelled','AbortError'));},{once:true}));
  const request=()=>new Request('https://lab.example/api/repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(EXAMPLES[0])});
  try{
    const response=await handleRequest(request(),{MODEL_API_KEY:'test'});assert.equal(response.status,200);
    await response.body.cancel();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(aborted,1);
    const next=await handleRequest(request(),{MODEL_API_KEY:'test'});assert.equal(next.status,200);
    await next.body.cancel();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(aborted,2);
  }finally{globalThis.fetch=original;}
});

test('reasoning is pinned to Spark 1.3 regardless of browser model parameters',async()=>{
  for(const model of ['muse-wonder-1.0','muse-spark-1.3']){
    let turn=0;
    const result=await repairArchitecture({}, {...EXAMPLES[0],model},()=>{},async(_env,body)=>{
      assert.equal(body.model,'muse-spark-1.3');turn++;
      const call=turn===1?{name:'evaluate_architecture',arguments:JSON.stringify({action:'add_cache',replicas:null,label:'Cache repeated reads'})}:{name:'finish_evaluation',arguments:JSON.stringify({candidate_id:'candidate_1',explanation:'Simulator evidence meets the targets.'})};
      return {choices:[{message:{role:'assistant',tool_calls:[{id:'call'+turn,type:'function',function:call}]}}]};
    });
    assert.equal(result.model,'muse-spark-1.3');assert.equal(result.selected.result.summary.passed,true);
  }

});
test('optional image generation uses a validated graph and reports provider errors without leaking response bodies',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(_url,request)=>{calls++;const body=JSON.parse(request.body);assert.equal(body.model,'muse-image-1.0');assert.ok(body.input.includes('PostgreSQL'));assert.ok(body.input.includes('Include a cache diamond or Redis ONLY if a redis node appears'));assert.ok(body.input.includes('Never bypass these stages'));return new Response('secret upstream diagnostics',{status:403});};
 await assert.rejects(architectureImage({MODEL_API_KEY:'test-key'},{graph:EXAMPLES[0].graph}),/HTTP 403/);
 assert.equal(calls,1);
 await assert.rejects(architectureImage({MODEL_API_KEY:'test-key'},{graph:{nodes:[],edges:[]}}),/supports/);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('missing key and malformed image requests fail before billable model operations',async()=>{
 const response=await handleRequest(new Request('https://lab.example/api/repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(EXAMPLES[0])}));assert.equal(response.status,503);assert.match((await response.json()).error,/Meta is not connected/);
 const imageResponse=await handleRequest(new Request('https://lab.example/api/architecture-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({graph:EXAMPLES[0].graph})}));assert.equal(imageResponse.status,400);assert.match((await imageResponse.json()).error,/key/);
});
