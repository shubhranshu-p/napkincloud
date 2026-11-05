import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.mjs';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';
import { EXAMPLES } from '../src/examples.mjs';

test('concurrent singles cannot overrun a reserved analysis budget', async () => {
  const original = globalThis.fetch;
  let chats = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/responses')) {
      return new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxWQAAAAASUVORK5CYII=' }] }));
    }
    const turn = (chats++) % 5;
    const fn = turn < 3
      ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: turn === 2 ? 'add_cache' : 'scale_api', replicas: turn === 0 ? 2 : turn === 1 ? 3 : null, label: 'c' + turn }) }
      : turn === 3
        ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: 'scale_api', replicas: 4, label: 'over' }) }
        : { name: 'finish_evaluation', arguments: JSON.stringify({ candidate_id: 'none', explanation: 'done' }) };
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c' + chats, type: 'function', function: fn }] } }] }));
  };
  try {
    const input = { graph: DEFAULT_GRAPH, workload: { ...DEFAULT_WORKLOAD, scenario: 'normal', baseRps: 1, peakRps: 1, duration: 5, seed: 21 } };
    const analyze = () => new Request('https://x.example/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const single = () => new Request('https://x.example/api/architecture-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: EXAMPLES[0].graph }) });
    for (let i = 0; i < 3; i++) {
      const r = await handleRequest(analyze(), { MODEL_API_KEY: 'k' });
      assert.equal(r.status, 200);
      await r.text();
    }
    const ap = handleRequest(analyze(), { MODEL_API_KEY: 'k' });
    await new Promise(r => setTimeout(r, 0));
    const srs = await Promise.all([single(), single(), single(), single()].map(q => handleRequest(q, { MODEL_API_KEY: 'k' })));
    const ar = await ap;
    assert.equal(ar.status, 200, 'reserved analysis starts');
    await ar.text();
    for (const r of srs) {
      assert.equal(r.status, 400, 'concurrent single blocked by reserved budget');
      assert.match((await r.json()).error, /limiting/);
    }
  } finally {
    globalThis.fetch = original;
  }
});
