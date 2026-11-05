import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';
import { handleRequest } from '../src/handler.mjs';
import { exportFiles, tarFiles } from '../src/export.mjs';
import { repairArchitecture } from '../src/meta.mjs';

const post = (path, input, headers = {}) => new Request(`https://lab.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
test('HTTP simulation validates topology, origin, and request content type', async () => {
  const response = await handleRequest(post('/api/simulate', { graph: DEFAULT_GRAPH, workload: DEFAULT_WORKLOAD }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).summary.generated, 39327);
  assert.equal((await handleRequest(post('/api/simulate', {}, { Origin: 'https://other.example' }))).status, 403);
  assert.equal((await handleRequest(post('/api/simulate', { graph: {}, workload: DEFAULT_WORKLOAD }))).status, 400);
  assert.equal((await handleRequest(new Request('https://lab.example/api/simulate', { method: 'POST', body: '{}' }))).status, 415);
});
test('bootstrap exposes configuration presence, never the credential', async () => {
  const response = await handleRequest(new Request('https://lab.example/api/bootstrap'), { MODEL_API_KEY: 'test-secret-never-return' });
  const text = await response.text();
  assert.ok(!text.includes('test-secret-never-return'));
  assert.equal(JSON.parse(text).connected, true);
});
test('offline comparisons are explicitly local and preserve the original graph', async () => {
  const input = { graph: DEFAULT_GRAPH, workload: DEFAULT_WORKLOAD };
  const r = await (await handleRequest(post('/api/compare', input))).json();
  assert.equal(r.mode, 'local'); assert.equal(r.candidates.length, 2);
  assert.equal(r.selected.patch.action, 'add_cache');
  assert.equal(r.stress.length, 3);
  assert.equal(input.graph.nodes.length, 3);
  assert.equal(r.candidates[0].result.summary.generated, r.candidates[1].result.summary.generated);
});
test('export recomputes evidence and tar contains actual application files', async () => {
  const { files, evidence } = await exportFiles({ graph: DEFAULT_GRAPH, workload: DEFAULT_WORKLOAD, patch: { action: 'add_cache' }, claimedSuccessRate: 0 });
  assert.equal(evidence.selected.summary.successRate, 1);
  assert.equal(evidence.verification.benchmark, false);
  assert.equal(evidence.verification.composeRuntime, false);
  assert.equal(evidence.inputHash.length, 64);
  assert.match(files['app/server.py'], /UPDATE products SET stock/);
  assert.match(files['app/server.py'], /cache\.setex/);
  assert.match(files['compose.yaml'], /REDIS_URL/);
  assert.equal(JSON.parse(files['before.json']).nodes.length, 3);
  assert.ok(!JSON.parse(files['before.json']).nodes.some(n => n.type === 'redis'), 'before.json predates the cache');
  const archive = tarFiles(files); let offset = 0; const parsed = {};
  while (archive[offset]) {
    const header = archive.slice(offset, offset + 512), decode = (a, b) => new TextDecoder().decode(header.slice(a, b)).replace(/\0.*$/, '');
    const name = decode(0, 100), size = parseInt(decode(124, 136), 8);
    parsed[name] = new TextDecoder().decode(archive.slice(offset + 512, offset + 512 + size));
    const expectedChecksum = parseInt(decode(148, 156), 8);
    header.fill(32, 148, 156);
    assert.equal(header.reduce((a, b) => a + b, 0), expectedChecksum);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(parsed, files);
});
test('agent uses real tool outputs and refuses to select a failing candidate (mock transport)', async () => {
  let turn = 0; const events = [];
  const messages = [
    { name: 'evaluate_architecture', args: { action: 'scale_api', replicas: 3, label: 'More API instances' } },
    { name: 'finish_evaluation', args: { candidate_id: 'candidate_1', explanation: 'This should not pass.' } },
    { name: 'evaluate_architecture', args: { action: 'add_cache', replicas: null, label: 'Cache catalog reads' } },
    { name: 'finish_evaluation', args: { candidate_id: 'candidate_2', explanation: 'The configured scenario passes; write overload remains a limitation.' } }
  ];
  const mockChat = async (_env, body) => {
    if (turn > 0) assert.equal(body.messages.at(-1).role, 'tool');
    const m = messages[turn++];
    return { usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `call${turn}`, type: 'function', function: { name: m.name, arguments: JSON.stringify(m.args) } }] } }] };
  };
  const r = await repairArchitecture({}, { graph: DEFAULT_GRAPH, workload: DEFAULT_WORKLOAD }, e => events.push(e), mockChat);
  assert.equal(r.selected.patch.action, 'add_cache');
  assert.ok(events.some(e => e.type === 'tool_error' && e.message.includes('did not meet')));
  assert.equal(r.candidates[0].result.summary.passed, false);
  assert.equal(r.candidates[1].result.summary.passed, true);
  assert.equal(r.usage.prompt_tokens, 40);
  assert.equal(events.at(-1).type, 'complete');
});
