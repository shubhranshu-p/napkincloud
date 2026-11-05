import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSketch } from '../src/meta.mjs';
import { validateGraph, applyPatch, DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';
import { simulate } from '../src/simulator.mjs';
import { handleRequest } from '../src/handler.mjs';

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

test('uploaded sketch extraction is sanitized to reviewable IDs and default capacities', async () => {
  const original = globalThis.fetch;
  const extracted = {
    title: '',
    nodes: [
      { id: '1client', label: 'Web', type: 'client', x: 25, y: 310, w: 160, h: 100 },
      { id: 'api!', label: 'API', type: 'api', x: 220, y: 310, w: 160, h: 100, capacity: 99999, concurrency: 128 },
      { id: 'db', label: '', type: 'postgres', x: 2000, y: 310, w: 150, h: 120 }
    ],
    edges: [
      { from: '1client', to: 'api!', when: 'all' },
      { from: 'api!', to: 'db', when: 'all' },
      { from: 'api!', to: 'ghost', when: 'read' }
    ],
    uncertainties: ['handwriting unclear']
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'r1', model: 'muse-spark-1.3', usage: {},
    choices: [{ message: { role: 'assistant', content: JSON.stringify(extracted) } }]
  }));
  try {
    const r = await compileSketch({ MODEL_API_KEY: 'fixture-key' }, 'data:image/png;base64,' + 'A'.repeat(100));
    assert.equal(r.needsReview, true);
    const ids = r.graph.nodes.map(n => n.id);
    assert.ok(ids.every(id => ID_RE.test(id)), 'every ID valid: ' + ids.join(','));
    assert.equal(new Set(ids).size, ids.length, 'IDs unique');
    for (const n of r.graph.nodes) {
      assert.ok(n.x >= 0 && n.x <= 1000 && n.y >= 0 && n.y <= 1000, 'position in bounds');
      assert.ok(n.w >= 30 && n.w <= 700 && n.h >= 30 && n.h <= 700, 'size in bounds');
      assert.ok(n.x + n.w <= 1010 && n.y + n.h <= 1010, 'box inside sketch');
      assert.ok(typeof n.label === 'string' && n.label.trim().length >= 1 && n.label.length <= 80, 'label usable');
      assert.notEqual(n.capacity, 99999, 'invented capacity not kept');
      assert.notEqual(n.concurrency, 128, 'invented concurrency not kept');
    }
    assert.ok(r.graph.edges.every(e => ids.includes(e.from) && ids.includes(e.to)), 'edges reference existing nodes');
    assert.ok(!r.graph.edges.some(e => e.from === 'ghost' || e.to === 'ghost'), 'dangling edge dropped');
    assert.equal(r.validationError, null, 'sanitized topology validates: ' + r.validationError);
  } finally {
    globalThis.fetch = original;
  }
});

test('add_cache preserves alternative all-routing across multiple databases', () => {
  const N = (id, label, type, x, y) => ({ id, label, type, x, y, w: type === 'postgres' ? 150 : 160, h: type === 'postgres' ? 120 : 100 });
  const W = (o) => ({ ...DEFAULT_WORKLOAD, scenario: 'normal', baseRps: 200, peakRps: 200, duration: 10, readRatio: 0.9, cacheHitRatio: 0.9, coldStart: false, queueLimit: 1000, deadlineMs: 5000, p95TargetMs: 5000, minSuccessRate: 0.5, seed: 42, ...o });
  const arrivals = (r, id) => r.nodes.find(n => n.id === id)?.arrivals ?? -1;
  // Dual all-split: unaffected branch counts must be exactly preserved; writes bypass the cache identically.
  const dual = { routingVersion: 2, title: 'dual db', source: 'test', nodes: [N('client', 'C', 'client', 25, 310), N('api', 'A', 'api', 220, 310), N('db1', 'D1', 'postgres', 420, 200), N('db2', 'D2', 'postgres', 420, 420)], edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db1' }, { from: 'api', to: 'db2' }], uncertainties: [] };
  for (const rr of [1, 0, 0.9]) {
    const w = W({ readRatio: rr });
    const base = simulate(validateGraph(dual), w);
    const patched = applyPatch(dual, { action: 'add_cache' });
    validateGraph(patched);
    const after = simulate(patched, w);
    assert.equal(after.summary.generated, base.summary.generated);
    assert.equal(arrivals(after, 'db2'), arrivals(base, 'db2'), `rr=${rr}: direct branch preserved exactly`);
    if (rr === 1) assert.equal(arrivals(after, 'cache'), arrivals(base, 'db1'), 'reads-only: cached branch takes the exact cached share');
    if (rr === 0) {
      assert.equal(after.summary.cacheLookups, 0, 'writes bypass the cache');
      assert.equal(arrivals(after, 'db1'), arrivals(base, 'db1'), 'writes-only: cached DB identical');
    }
    if (rr === 0.9) assert.ok(arrivals(after, 'db1') < arrivals(base, 'db1'), 'mixed: cached DB sheds reads to the cache');
  }
  // Mixed all + explicit write: reads split across all-branches, writes keep the explicit branch only.
  const mixed = { routingVersion: 2, title: 'm', source: 't', nodes: [N('client', 'C', 'client', 25, 310), N('api', 'A', 'api', 220, 310), N('db1', 'D1', 'postgres', 420, 100), N('db2', 'D2', 'postgres', 420, 310), N('db3', 'D3', 'postgres', 420, 520)], edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db1' }, { from: 'api', to: 'db2' }, { from: 'api', to: 'db3', when: 'write' }], uncertainties: [] };
  const pm = applyPatch(mixed, { action: 'add_cache' });
  assert.ok(!pm.edges.some(e => e.from === 'api' && e.to === 'db1' && e.when === 'write'), 'no spurious write added where writes never went');
  const mr = simulate(pm, W({ readRatio: 1 })), mr0 = simulate(validateGraph(mixed), W({ readRatio: 1 }));
  assert.equal(arrivals(mr, 'db2'), arrivals(mr0, 'db2'));
  assert.equal(arrivals(mr, 'db3'), 0);
  const mw = simulate(pm, W({ readRatio: 0 })), mw0 = simulate(validateGraph(mixed), W({ readRatio: 0 }));
  assert.equal(mw.summary.cacheLookups, 0);
  assert.equal(arrivals(mw, 'db3'), arrivals(mw0, 'db3'));
  // Mixed explicit read + all: the all-branch was write-only and stays write-only.
  const mixed2 = { routingVersion: 2, title: 'm2', source: 't', nodes: [N('client', 'C', 'client', 25, 310), N('api', 'A', 'api', 220, 310), N('db1', 'D1', 'postgres', 420, 200), N('db2', 'D2', 'postgres', 420, 420)], edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db1', when: 'read' }, { from: 'api', to: 'db2' }], uncertainties: [] };
  const p2 = applyPatch(mixed2, { action: 'add_cache' });
  assert.ok(p2.edges.some(e => e.from === 'api' && e.to === 'db2' && e.when === 'write'), 'write-only branch preserved explicitly');
  assert.ok(!p2.edges.some(e => e.from === 'api' && e.to === 'db2' && e.when === 'read'), 'no spurious read added to a write-only branch');
  const r2 = simulate(p2, W({ readRatio: 1 })), r20 = simulate(validateGraph(mixed2), W({ readRatio: 1 }));
  assert.equal(arrivals(r2, 'cache'), arrivals(r20, 'db1'));
  assert.equal(arrivals(r2, 'db2'), 0);
  const w2 = simulate(p2, W({ readRatio: 0 })), w20 = simulate(validateGraph(mixed2), W({ readRatio: 0 }));
  assert.equal(w2.summary.cacheLookups, 0);
  assert.equal(arrivals(w2, 'db2'), arrivals(w20, 'db2'));
});

test('four-mebibyte uploads pass server size validation', async () => {
  const make = (len) => 'data:image/jpeg;base64,' + 'A'.repeat(len - 'data:image/jpeg;base64,'.length);
  // 4 MiB binary -> 5,592,431-char data URL; must pass. 5,600,001 must still reject.
  const under = make(5550000);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      id: 'r1', model: 'muse-spark-1.3', usage: {},
      choices: [{ message: { role: 'assistant', content: JSON.stringify({
        title: 't',
        nodes: [
          { id: 'client', label: 'C', type: 'client', x: 25, y: 310, w: 160, h: 100 },
          { id: 'api', label: 'A', type: 'api', x: 220, y: 310, w: 160, h: 100 },
          { id: 'db', label: 'D', type: 'postgres', x: 420, y: 310, w: 150, h: 120 }
        ],
        edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db' }],
        uncertainties: []
      }) } }]
    }));
  };
  try {
    const r = await compileSketch({ MODEL_API_KEY: 'fixture-key' }, under);
    assert.equal(calls, 1, 'under-limit image reaches the model transport');
    assert.equal(r.validationError, null);
  } finally {
    globalThis.fetch = original;
  }
  calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not call transport'); };
  try {
    await assert.rejects(compileSketch({ MODEL_API_KEY: 'fixture-key' }, make(5600001)), /under 4 MB/);
    assert.equal(calls, 0, 'over-limit image fails before transport');
  } finally {
    globalThis.fetch = original;
  }
});

test('upstream model calls are budgeted separately from endpoint starts', async () => {
  const original = globalThis.fetch;
  let chats = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/responses')) {
      return new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxWQAAAAASUVORK5CYII=' }] }));
    }
    const turn = (chats++) % 5;
    const fn = turn < 3
      ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: turn === 2 ? 'add_cache' : 'scale_api', replicas: turn === 0 ? 2 : turn === 1 ? 3 : null, label: 'candidate ' + turn }) }
      : turn === 3
        ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: 'scale_api', replicas: 4, label: 'over limit' }) }
        : { name: 'finish_evaluation', arguments: JSON.stringify({ candidate_id: 'none', explanation: 'test done' }) };
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c' + chats, type: 'function', function: fn }] } }] }));
  };
  try {
    const input = { graph: DEFAULT_GRAPH, workload: { ...DEFAULT_WORKLOAD, scenario: 'normal', baseRps: 1, peakRps: 1, duration: 5, seed: 7 } };
    const post = () => new Request('https://app.example/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    // Four full generations: 4 endpoint starts + 24 upstream calls (5 chats + 1 image each).
    for (let i = 0; i < 4; i++) {
      const res = await handleRequest(post(), { MODEL_API_KEY: 'fixture-key' });
      assert.equal(res.status, 200, 'generation ' + (i + 1) + ' starts');
      const last = (await res.text()).trim().split('\n').map(JSON.parse).at(-1);
      assert.equal(last.type, 'complete');
    }
    assert.equal(chats, 20, 'four generations used 20 chats');
    const blocked = await handleRequest(post(), { MODEL_API_KEY: 'fixture-key' });
    assert.equal(blocked.status, 400, 'fifth generation blocked by upstream budget');
    assert.match((await blocked.json()).error, /limiting/);
  } finally {
    globalThis.fetch = original;
  }
});
