import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.mjs';

const VALID_EXTRACTION = {
  title: 't',
  nodes: [
    { id: 'client', label: 'C', type: 'client', x: 25, y: 310, w: 160, h: 100 },
    { id: 'api', label: 'A', type: 'api', x: 220, y: 310, w: 160, h: 100 },
    { id: 'db', label: 'D', type: 'postgres', x: 420, y: 310, w: 150, h: 120 }
  ],
  edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db' }],
  uncertainties: []
};

test('an actual 4 MiB file passes the full upload request path', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ id: 'r1', model: 'muse-spark-1.3', usage: {}, choices: [{ message: { role: 'assistant', content: JSON.stringify(VALID_EXTRACTION) } }] }));
  };
  try {
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.alloc(4 * 1024 * 1024, 0xab).toString('base64');
    assert.equal(dataUrl.length, 5592431, 'exact 4 MiB data URL length');
    const body = JSON.stringify({ image: dataUrl });
    assert.ok(body.length < 6000000, 'JSON request stays under the handler limit');
    const res = await handleRequest(new Request('https://x.example/api/compile-sketch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) }, body }), { MODEL_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.validationError, null);
    assert.equal(out.needsReview, true);
    assert.equal(calls, 1);

    const over = 'data:image/jpeg;base64,' + 'A'.repeat(5600001 - 'data:image/jpeg;base64,'.length);
    const overBody = JSON.stringify({ image: over });
    const denied = await handleRequest(new Request('https://x.example/api/compile-sketch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(overBody.length) }, body: overBody }), { MODEL_API_KEY: 'k' });
    assert.equal(denied.status, 400);
    assert.match((await denied.json()).error, /under 4 MB/);
    assert.equal(calls, 1, 'over-limit upload never reaches transport');
  } finally {
    globalThis.fetch = original;
  }
});
