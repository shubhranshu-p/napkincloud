import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.mjs';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';

test('unused upstream reservations are refunded when generation finishes', async () => {
  const original = globalThis.fetch;
  let chats = 0, images = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/responses')) { images++; throw new Error('no image expected without a candidate'); }
    chats++;
    const fn = { name: 'finish_evaluation', arguments: JSON.stringify({ candidate_id: 'none', explanation: 'minimal' }) };
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c' + chats, type: 'function', function: fn }] } }] }));
  };
  try {
    const input = { graph: DEFAULT_GRAPH, workload: { ...DEFAULT_WORKLOAD, scenario: 'normal', baseRps: 1, peakRps: 1, duration: 5, seed: 23 } };
    const analyze = () => new Request('https://x.example/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    // Each minimal run attempts 1 chat and reserves 6 upfront; 4 runs must NOT exhaust 24.
    for (let i = 0; i < 4; i++) {
      const r = await handleRequest(analyze(), { MODEL_API_KEY: 'k' });
      assert.equal(r.status, 200, 'minimal analysis ' + (i + 1) + ' starts');
      const last = (await r.text()).trim().split('\n').map(JSON.parse).at(-1);
      assert.equal(last.type, 'complete');
      assert.equal(last.result.selected, null);
    }
    assert.equal(chats, 4);
    assert.equal(images, 0);
    const fifth = await handleRequest(analyze(), { MODEL_API_KEY: 'k' });
    assert.equal(fifth.status, 200, 'refunded budget leaves room for a fifth run');
    await fifth.text();
    assert.equal(chats, 5);
  } finally {
    globalThis.fetch = original;
  }
});
