import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSketch } from '../src/meta.mjs';

test('duplicate IDs are never guessed; every correction is itemized', async () => {
  const original = globalThis.fetch;
  const extracted = {
    title: 'dup arch',
    nodes: [
      { id: 'api', label: 'API one', type: 'api', x: 220, y: 310, w: 160, h: 100 },
      { id: 'api', label: 'API two', type: 'api', x: 220, y: 500, w: 160, h: 100 },
      { id: 'client', label: 'C', type: 'client', x: 25, y: 310, w: 160, h: 100 },
      { id: 'db', label: 'D', type: 'postgres', x: 420, y: 310, w: 150, h: 120 },
      { id: 'kafka', label: 'Q', type: 'kafka', x: 420, y: 500, w: 160, h: 100, capacity: 77777 }
    ],
    edges: [
      { from: 'client', to: 'api', when: 'all' },
      { from: 'api', to: 'db', when: 'all' },
      { from: 'api', to: 'ghost', when: 'read' }
    ],
    uncertainties: ['model note']
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'r', model: 'm', usage: {}, choices: [{ message: { content: JSON.stringify(extracted) } }] }));
  try {
    const r = await compileSketch({ MODEL_API_KEY: 'k' }, 'data:image/png;base64,' + 'A'.repeat(64));
    const ids = r.graph.nodes.map(n => n.id);
    assert.ok(ids.includes('api') && ids.some(id => id !== 'api' && r.graph.nodes.find(n => n.id === id).label === 'API two'), 'both duplicates kept with distinct IDs');
    assert.equal(r.graph.edges.length, 0, 'no edge guesses a duplicate destination');
    assert.ok(r.validationError, 'ambiguous graph blocks confirmation until explicitly rewired');
    const notes = (r.graph.corrections || []).join(' | ');
    assert.match(notes, /Duplicate ID 'api' on 2 components \(API one, API two\)/, 'duplicate parties named');
    assert.match(notes, /client' → 'api' \(ambiguous duplicate ID/, 'dropped edge itemized');
    assert.match(notes, /Types reset to service: 'kafka' on 'Q'/, 'type coercion itemized');
    assert.match(notes, /Assumed default capacities on: Q \(not measured/, 'assumed capacities labeled, never measured');
    assert.ok(!JSON.stringify(r.graph).includes('77777'), 'invented capacity stripped');
    assert.deepEqual(r.graph.uncertainties, ['model note'], 'model notes kept separate from corrections');
  } finally {
    globalThis.fetch = original;
  }
});

test('correction history survives validation past the 8-note uncertainties cap', async () => {
  const original = globalThis.fetch;
  const ghosts = Array.from({ length: 10 }, (_, i) => ({ from: 'api', to: 'ghost' + i, when: 'read' }));
  const extracted = {
    title: 't',
    nodes: [
      { id: 'client', label: 'C', type: 'client', x: 25, y: 310, w: 160, h: 100 },
      { id: 'api', label: 'A', type: 'api', x: 220, y: 310, w: 160, h: 100 },
      { id: 'db', label: 'D', type: 'postgres', x: 420, y: 310, w: 150, h: 120 }
    ],
    edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db' }, ...ghosts],
    uncertainties: []
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'r', model: 'm', usage: {}, choices: [{ message: { content: JSON.stringify(extracted) } }] }));
  try {
    const r = await compileSketch({ MODEL_API_KEY: 'k' }, 'data:image/png;base64,' + 'A'.repeat(64));
    assert.equal(r.validationError, null, 'dangling extras drop without invalidating the core topology');
    assert.equal(r.graph.edges.length, 2);
    assert.equal(r.graph.corrections.length, 10, 'all ten drops preserved, not truncated to 8');
    assert.ok(r.graph.corrections.every(c => c.includes('unknown') && c.length <= 250));
  } finally {
    globalThis.fetch = original;
  }
});
