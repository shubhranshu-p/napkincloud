import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.mjs';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';
import { evaluatePatch, simulate } from '../src/simulator.mjs';
import { makeHistoryEntry } from '../src/history.mjs';
import { experimentDiagnosis } from '../src/diagnostics.mjs';
import { architectureSvg } from '../src/diagram.mjs';

test('a passing alternative with no selection is never labeled failed', async () => {
  const original = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/responses')) {
      return new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxWQAAAAASUVORK5CYII=' }] }));
    }
    turn++;
    const fn = turn === 1
      ? { name: 'evaluate_architecture', arguments: JSON.stringify({ action: 'scale_api', replicas: 2, label: 'scale' }) }
      : { name: 'finish_evaluation', arguments: JSON.stringify({ candidate_id: 'none', explanation: 'Baseline already meets targets; no change needed.' }) };
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c' + turn, type: 'function', function: fn }] } }] }));
  };
  try {
    const input = { graph: DEFAULT_GRAPH, workload: { ...DEFAULT_WORKLOAD, scenario: 'normal', baseRps: 1, peakRps: 1, duration: 5, seed: 31 } };
    const res = await handleRequest(new Request('https://x.example/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), { MODEL_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const last = (await res.text()).trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(last.type, 'complete');
    assert.equal(last.result.selected, null);
    assert.equal(last.result.displayedCandidate.result.summary.passed, true);
    assert.equal(last.result.diagnosis.outcome, 'no_selection');
    assert.match(last.result.diagnosis.why, /no repair was selected|no change is required/);
    assert.ok(!last.result.diagnosis.why.includes('did not meet'), 'why must not claim failure');

    const session = {
      graph: structuredClone(DEFAULT_GRAPH), workload: structuredClone(input.workload), image: null, reviewed: true,
      baseline: simulate(DEFAULT_GRAPH, input.workload), analysis: last.result, displayed: last.result.displayedCandidate,
      timings: { testMs: 50 }, historyId: 'h1', runCreatedAt: new Date().toISOString()
    };
    const entry = makeHistoryEntry(session, 'custom', architectureSvg(DEFAULT_GRAPH));
    assert.equal(entry.outcome, 'no_selection');
    session.analysis = { ...last.result, selected: last.result.displayedCandidate };
    assert.equal(makeHistoryEntry(session, 'custom', architectureSvg(DEFAULT_GRAPH)).outcome, 'passed');
    session.analysis = { ...last.result, selected: null };
    session.displayed = { ...last.result.displayedCandidate, result: { ...last.result.displayedCandidate.result, summary: { ...last.result.displayedCandidate.result.summary, passed: false } } };
    assert.equal(makeHistoryEntry(session, 'custom', architectureSvg(DEFAULT_GRAPH)).outcome, 'insufficient');
  } finally {
    globalThis.fetch = original;
  }
});


test('no selection never claims a failing original already meets targets',()=>{
 const baseline=simulate(DEFAULT_GRAPH,DEFAULT_WORKLOAD),candidate=evaluatePatch(DEFAULT_GRAPH,DEFAULT_WORKLOAD,{action:'add_cache'});
 assert.equal(baseline.summary.passed,false);assert.equal(candidate.result.summary.passed,true);
 const d=experimentDiagnosis({baseline,selected:null},candidate);
 assert.equal(d.outcome,'no_selection');assert.match(d.why,/original design still fails/);assert.doesNotMatch(d.why,/already meets|no change is required/);
});
