import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD, copy, applyPatch, validateGraph } from '../src/model.mjs';
import { simulate } from '../src/simulator.mjs';

test('fixed seeds reproduce complete run results and conserve every request', () => {
  const a = simulate(DEFAULT_GRAPH, DEFAULT_WORKLOAD), b = simulate(DEFAULT_GRAPH, DEFAULT_WORKLOAD);
  assert.deepEqual(a, b);
  const s = a.summary;
  assert.equal(s.generated, s.completed + s.rejected + s.timedOut + s.inFlight);
  assert.equal(s.inFlight, 0);
  assert.ok(s.rejected > 0);
});
test('a read cache improves the burst without changing arrivals or write semantics', () => {
  const base = simulate(DEFAULT_GRAPH, DEFAULT_WORKLOAD);
  const cached = simulate(applyPatch(DEFAULT_GRAPH, { action: 'add_cache' }), DEFAULT_WORKLOAD);
  assert.equal(base.summary.generated, cached.summary.generated);
  assert.ok(cached.summary.successRate > base.summary.successRate);
  assert.ok(cached.summary.passed);
  assert.ok(cached.nodes.find(n => n.type === 'postgres').arrivals < base.nodes.find(n => n.type === 'postgres').arrivals);
});
test('additional API replicas do not repair a database throughput deficit', () => {
  const scaled = simulate(applyPatch(DEFAULT_GRAPH, { action: 'scale_api', replicas: 3 }), DEFAULT_WORKLOAD);
  assert.equal(scaled.summary.passed, false);
  assert.equal(scaled.summary.bottleneck, 'db');
});
test('cache cannot absorb write-only traffic; zero-hit cache does not invent hits', () => {
  const graph = applyPatch(DEFAULT_GRAPH, { action: 'add_cache' });
  const writes = simulate(graph, { ...DEFAULT_WORKLOAD, readRatio: 0 });
  assert.equal(writes.summary.cacheLookups, 0);
  assert.equal(writes.summary.cacheHits, 0);
  assert.equal(writes.summary.passed, false);
  const misses = simulate(graph, { ...DEFAULT_WORKLOAD, cacheHitRatio: 0 });
  assert.equal(misses.summary.cacheHits, 0);
});
test('deadlines expire waiting and running requests and free queue bookkeeping', () => {
  const r = simulate(DEFAULT_GRAPH, { ...DEFAULT_WORKLOAD, queueLimit: 1000, deadlineMs: 20 });
  assert.ok(r.summary.timedOut > 0);
  assert.equal(r.summary.inFlight, 0);
  for (const t of r.timeline) for (const n of Object.values(t.nodes)) assert.ok(n.queue >= 0);
});
test('normal traffic meets targets; low hit ratio and cold starts retain their costs', () => {
  assert.ok(simulate(DEFAULT_GRAPH, { ...DEFAULT_WORKLOAD, scenario: 'normal' }).summary.passed);
  const cached = applyPatch(DEFAULT_GRAPH, { action: 'add_cache' });
  const warm = simulate(cached, DEFAULT_WORKLOAD);
  const cold = simulate(cached, { ...DEFAULT_WORKLOAD, coldStart: true });
  assert.ok(cold.summary.successRate <= warm.summary.successRate);
});
test('patches cannot modify protected inputs and graph topology cannot be silently ignored', () => {
  assert.throws(() => applyPatch(DEFAULT_GRAPH, { action: 'add_cache', capacity: 1000000 }), /protected/);
  assert.throws(() => applyPatch(DEFAULT_GRAPH, { action: 'scale_api', replicas: 2.5 }), /integer/);
  const g = copy(DEFAULT_GRAPH); g.edges.reverse(); g.edges[0] = { from: 'db', to: 'api' };
  assert.throws(() => validateGraph(g), /directed/);
  const bad = copy(DEFAULT_GRAPH); bad.nodes[1].type = 'kafka';
  assert.throws(() => validateGraph(bad), /supported/);
});
