import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../src/examples.mjs';
import { applyPatch,validateGraph } from '../src/model.mjs';
import { simulate,stressSuite } from '../src/simulator.mjs';
import { repairArchitecture } from '../src/meta.mjs';
import { architectureSvg } from '../src/diagram.mjs';
import { makeHistoryEntry,restoreHistoryEntry,formatElapsed } from '../src/history.mjs';
const third=EXAMPLES.find(e=>e.id==='concert');
test('third example is repaired by independent partitions without altering workload or per-store capacity',()=>{
 const before=simulate(third.graph,third.workload),graph=applyPatch(third.graph,{action:'partition_database',partitions:6,databaseId:'db'}),after=simulate(graph,third.workload);
 assert.equal(before.summary.passed,false);assert.equal(after.summary.passed,true);assert.equal(after.summary.generated,before.summary.generated);assert.deepEqual(after.workload,before.workload);assert.equal(after.summary.generated,after.summary.completed+after.summary.rejected+after.summary.timedOut);assert.equal(after.summary.inFlight,0);
 const stores=graph.nodes.filter(n=>n.partitionGroup==='db');assert.equal(stores.length,6);assert.ok(stores.every(n=>n.capacity===600&&n.concurrency===6&&n.replicas===1));assert.equal(third.graph.nodes.length,8);
 const svg=architectureSvg(graph,after);assert.match(svg,/6 partitions/);assert.match(svg,/Tenant router/);
});
test('hot-tenant concentration remains a visible failure mode and invalid partition patches are rejected',()=>{
 const graph=applyPatch(third.graph,{action:'partition_database',partitions:8});const skew=stressSuite(graph,third.workload).find(t=>t.name==='Hot-tenant concentration');assert.equal(skew.summary.passed,false);
 for(const partitions of [1,9,3.5])assert.throws(()=>applyPatch(third.graph,{action:'partition_database',partitions}));
 assert.throws(()=>applyPatch(third.graph,{action:'partition_database',partitions:6,capacity:100000}),/protected/);
 const forged=structuredClone(graph);forged.partitioning.databaseIds[0]='api';assert.throws(()=>validateGraph(forged),/partition/);
});
test('partition members must keep the original concurrency; pre-existing groups without the field still validate',()=>{
 const graph=applyPatch(third.graph,{action:'partition_database',partitions:6,databaseId:'db'});
 assert.equal(graph.partitioning.concurrencyPerPartition,6);
 const forged=structuredClone(graph);forged.nodes.find(n=>n.id===forged.partitioning.databaseIds[1]).concurrency=128;
 assert.throws(()=>validateGraph(forged),/partition/);
 const legacy=structuredClone(graph);delete legacy.partitioning.concurrencyPerPartition;
 validateGraph(legacy);
});
test('hot-tenant skew concentrates half the keys on one store',()=>{
 const graph=applyPatch(third.graph,{action:'partition_database',partitions:8});
 const r=simulate(graph,{...third.workload,partitionSkew:.5});
 const counts=graph.partitioning.databaseIds.map(id=>r.nodes.find(n=>n.id===id).arrivals);
 const total=counts.reduce((a,b)=>a+b,0),hot=counts[0]/total;
 assert.ok(hot>0.45&&hot<0.55,`hot store share ${hot}`);
 assert.ok(counts.slice(1).every(c=>c>0),'remaining keys spread over the other stores');
});
test('bounded verification rescues the write bottleneck when the model returns no passing solution',async()=>{
 let turn=0;const mock=async()=>{turn++;const fn=turn===1?{name:'evaluate_architecture',arguments:JSON.stringify({action:'add_cache',replicas:null,label:'Cache reads'})}:{name:'finish_evaluation',arguments:JSON.stringify({candidate_id:'none',explanation:'Cache alone did not meet the targets.'})};return {choices:[{message:{role:'assistant',tool_calls:[{id:'call'+turn,type:'function',function:fn}]}}]};};
 const result=await repairArchitecture({},third,()=>{},mock);assert.equal(turn,2);assert.equal(result.selected.result.summary.passed,true);assert.equal(result.selected.origin,'verified_search');assert.ok(result.escalations.length<=7);assert.match(result.explanation,/bounded local search/);
});
test('history snapshots keep their original graph and images while restoration makes an independent editable copy',()=>{
 const baseline=simulate(third.graph,third.workload),session={graph:structuredClone(third.graph),workload:structuredClone(third.workload),image:third.sketch,reviewed:true,baseline,analysis:null,timings:{testMs:120},historyId:'fixture-history',runCreatedAt:'2026-11-05T00:00:00Z'};
 const entry=makeHistoryEntry(session,'concert',architectureSvg(third.graph));assert.match(entry.session.image,/^data:image\/svg/);session.graph.nodes[0].label='Changed';assert.notEqual(entry.session.graph.nodes[0].label,'Changed');
 const restored=restoreHistoryEntry(entry);assert.equal(restored.historyId,null);assert.equal(restored.restoredAt,entry.createdAt);restored.workload.peakRps=1;assert.equal(entry.session.workload.peakRps,third.workload.peakRps);assert.equal(entry.id,'fixture-history');
 assert.throws(()=>restoreHistoryEntry({version:99}),/incompatible/);assert.throws(()=>makeHistoryEntry({graph:third.graph},'custom'),/completed tests/);
});
test('elapsed times are brief and handle minute rollover',()=>{assert.equal(formatElapsed(1234),'1.2s');assert.equal(formatElapsed(61000),'1m 01s');assert.equal(formatElapsed(119990),'2m 00s');assert.equal(formatElapsed(null),'—');});

test('partition repair supports maximum-length uploaded IDs and labels without invalidating the graph',()=>{
 const g=structuredClone(third.graph),id='d'.repeat(40),db=g.nodes.find(n=>n.id==='db');db.id=id;db.label='Database'.repeat(10);g.edges.forEach(e=>{if(e.to==='db')e.to=id;});
 const repaired=applyPatch(g,{action:'partition_database',partitions:6});assert.equal(repaired.partitioning.partitions,6);assert.ok(repaired.nodes.every(n=>n.id.length<=40&&n.label.length<=80));assert.throws(()=>applyPatch(repaired,{action:'partition_database',partitions:2}),/one partition group/);
 const forged=structuredClone(repaired);forged.partitioning.capacityPerPartition=100000;assert.throws(()=>validateGraph(forged),/partition/);
});


test('zero skew uses every independent partition and preserves arrivals',()=>{
 for(const partitions of [2,6,8]){
  const graph=applyPatch(third.graph,{action:'partition_database',partitions});
  const r=simulate(graph,{...third.workload,partitionSkew:0});
  const counts=graph.partitioning.databaseIds.map(id=>r.nodes.find(n=>n.id===id).arrivals);
  assert.ok(counts.every(c=>c>0),'all configured stores receive traffic: '+counts);
  assert.equal(counts.reduce((a,b)=>a+b,0),r.nodes.find(n=>n.id===graph.partitioning.routerId).served);
  const share=counts[0]/counts.reduce((a,b)=>a+b,0);
  assert.ok(share>.65/partitions&&share<1.35/partitions,'first store has a reasonable uniform share');
 }
});
