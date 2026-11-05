import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compileSketch, interpretScenario, repairArchitecture } from '../src/meta.mjs';
import { DEFAULT_GRAPH, DEFAULT_WORKLOAD } from '../src/model.mjs';
process.loadEnvFile('.env');
mkdirSync('.local', { recursive: true });
const action = process.argv[2];
if (action === 'vision') {
  const image = 'data:image/png;base64,' + readFileSync('.local/vision-fixture.png').toString('base64');
  const r = await compileSketch(process.env, image);
  writeFileSync('.local/vision-result.json', JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ model: r.model, nodes: r.graph.nodes.map(n => ({ label: n.label, type: n.type })), validationError: r.validationError, usage: r.usage }));
  if (r.validationError) process.exitCode = 1;
} else if (action === 'scenario') {
  const r = await interpretScenario(process.env, 'Increase traffic to 4500 requests per second and make 80 percent of requests writes.', DEFAULT_WORKLOAD);
  writeFileSync('.local/scenario-result.json', JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r));
} else if (action === 'agent') {
  const r = await repairArchitecture(process.env, { graph: DEFAULT_GRAPH, workload: DEFAULT_WORKLOAD }, e => {
    if (['tool_call', 'evaluation', 'decision', 'tool_error'].includes(e.type)) console.log(JSON.stringify({ type: e.type, message: e.message, passed: e.candidate?.result.summary.passed }));
  });
  writeFileSync('.local/agent-result.json', JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ model: r.model, selected: r.selected?.patch, usage: r.usage, toolCalls: r.toolCalls }));
  if (!r.selected) process.exitCode = 1;
} else throw new Error('Use vision, scenario, or agent.');
