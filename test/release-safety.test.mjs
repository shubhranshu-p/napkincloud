import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.mjs';
import { EXAMPLES } from '../src/examples.mjs';
const request=path=>new Request('https://demo.example'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(EXAMPLES[0])});
test('expired judging access blocks paid paths before provider calls but keeps simulation usable',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected provider request');};
 try{for(const path of ['/api/analyze','/api/repair','/api/compile-sketch','/api/architecture-image','/api/scenario']){const r=await handleRequest(request(path),{MODEL_API_KEY:'fixture',META_ACCESS_UNTIL:'2020-01-01T00:00:00Z'});assert.equal(r.status,503);assert.match((await r.json()).error,/window has ended/);}assert.equal(calls,0);assert.equal((await handleRequest(request('/api/simulate'),{META_ACCESS_UNTIL:'2020-01-01'})).status,200);
 const invalid=await handleRequest(request('/api/analyze'),{META_ACCESS_UNTIL:'invalid'});assert.equal(invalid.status,503);
 }finally{globalThis.fetch=old;}
});
