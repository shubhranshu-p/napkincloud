import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.mjs';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';

test('failed upstream attempts still consume the reserved budget', async () => {
  const original = globalThis.fetch;
  let chats = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/responses')) return new Response('image provider failure', { status: 500 });
    const turn = (chats++) % 5;
    const fn = turn < 3
      ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: turn === 2 ? 'add_cache' : 'scale_api', replicas: turn === 0 ? 2 : turn === 1 ? 3 : null, label: 'c' + turn }) }
      : turn === 3
        ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: 'scale_api', replicas: 4, label: 'over' }) }
        : { name: 'finish_evaluation', arguments: JSON.stringify({ candidate_id: 'none', explanation: 'done' }) };
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c' + chats, type: 'function', function: fn }] } }] }));
  };
  try {
    const input = { graph: DEFAULT_GRAPH, workload: { ...DEFAULT_WORKLOAD, scenario: 'normal', baseRps: 1, peakRps: 1, duration: 5, seed: 22 } };
    const analyze = () => new Request('https://x.example/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    for (let i = 0; i < 4; i++) {
      const r = await handleRequest(analyze(), { MODEL_API_KEY: 'k' });
      assert.equal(r.status, 200, 'failed-image analysis still starts (attempt reserved)');
      const last = (await r.text()).trim().split('\n').map(JSON.parse).at(-1);
      assert.equal(last.type, 'complete', 'failed image preserves numerical findings');
      assert.equal(last.result.image, null);
      assert.match(last.result.imageError, /500/);
      assert.ok(!last.result.imageError.includes('image provider failure'), 'upstream body not leaked');
    }
    const blocked = await handleRequest(analyze(), { MODEL_API_KEY: 'k' });
    assert.equal(blocked.status, 400, 'fifth analysis blocked by attempted budget');
    assert.match((await blocked.json()).error, /limiting/);
  } finally {
    globalThis.fetch = original;
  }
});
