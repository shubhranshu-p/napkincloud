import { VERSION, validateGraph, validateWorkload, applyPatch, flowTargets } from './model.mjs';

class Heap {
  constructor() { this.a = []; this.order = 0; }
  push(event) {
    event.order = this.order++;
    const a = this.a; a.push(event); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p].time < event.time || (a[p].time === event.time && a[p].order < event.order)) break; a[i] = a[p]; i = p; }
    a[i] = event;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && (a[c + 1].time < a[c].time || (a[c + 1].time === a[c].time && a[c + 1].order < a[c].order))) c++;
        if (last.time < a[c].time || (last.time === a[c].time && last.order < a[c].order)) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return top;
  }
}
function randomStream(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function keyed(seed, id, salt) {
  let n = (seed ^ Math.imul(id + 1, 2654435761) ^ salt) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 2246822507); n = Math.imul(n ^ (n >>> 13), 3266489909);
  return (((n ^ (n >>> 16)) >>> 0) + 0.5) / 4294967296;
}
function percentile(sorted, p) { return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null; }
function round(n, digits = 2) { return n === null ? null : Number(n.toFixed(digits)); }
export function simulate(graphInput, workloadInput) {
  const graph = validateGraph(graphInput), w = validateWorkload(workloadInput);
  const flow=graph.routingVersion===2;
  const heap = new Heap(), rng = randomStream(w.seed), requests = [], stages = new Map();
  let completed = 0, rejected = 0, timedOut = 0, cacheHits = 0, cacheLookups = 0;
  const latencies = [], timeline = [];
  const api = graph.nodes.find(n => n.type === 'api'), db = graph.nodes.find(n => n.type === 'postgres'), cache = graph.nodes.find(n => n.type === 'redis');
  for (const n of graph.nodes.filter(n => n.type !== 'client')) {
    const cap = n.capacity * n.replicas * (n.type === 'postgres' ? w.dbSlowdown : 1);
    stages.set(n.id, { id: n.id, type: n.type, servers: n.concurrency * n.replicas, capacity: cap, busy: 0, queue: [], head: 0, pending: 0, arrivals: 0, served: 0, maxQueue: 0, busyTime: 0, rejected: 0, timedOut: 0 });
  }
  const phases = w.scenario === 'normal'
    ? [{ start: 0, end: w.duration, rate: w.baseRps }]
    : [{ start: 0, end: w.duration * .2, rate: w.baseRps }, { start: w.duration * .2, end: w.duration * .8, rate: w.peakRps }, { start: w.duration * .8, end: w.duration, rate: w.baseRps }];
  for (const p of phases) {
    let time = p.start;
    while ((time += -Math.log(Math.max(rng(), 1e-12)) / p.rate) < p.end) {
      const id = requests.length;
      if (id >= 170000) throw new Error('Simulation request limit reached. Reduce traffic.');
      requests.push({ id, arrival: time, read: keyed(w.seed, id, 10) < w.readRatio, status: 'not_arrived', stage: null, queued: false });
      heap.push({ time, kind: 'arrival', id });
    }
  }
  const count = requests.length;
  for (let t = 0; t <= Math.ceil(w.duration + w.deadlineMs / 1000); t++) heap.push({ time: t, kind: 'snapshot' });
  const end = w.duration + w.deadlineMs / 1000;
  function service(stage, req, t) {
    stage.busy++; req.queued = false;
    const salt = flow?100+graph.nodes.findIndex(n=>n.id===stage.id)*17:stage.type === 'api' ? 20 : stage.type === 'postgres' ? 30 : 40;
    const duration = -Math.log(keyed(w.seed, req.id, salt)) * stage.servers / stage.capacity;
    stage.busyTime += Math.max(0, Math.min(duration, end - t));
    heap.push({ time: t + duration, kind: 'complete', id: req.id, node: stage.id });
  }
  function enter(req, stage, t) {
    req.stage = stage.id; stage.arrivals++;if(flow&&stage.type==='redis'&&req.read)cacheLookups++;
    if (stage.busy < stage.servers) service(stage, req, t);
    else if (stage.pending < w.queueLimit) {
      req.queued = true; stage.queue.push(req.id); stage.pending++; stage.maxQueue = Math.max(stage.maxQueue, stage.pending);
    } else { req.status = 'rejected'; rejected++; stage.rejected++; }
  }
  function advance(req,id,t){const edges=flowTargets(graph,id,req.read);if(!edges.length){finish(req,t);return;}const router=graph.nodes.find(n=>n.id===id);const tenant=Math.floor(keyed(w.seed,req.id,61)*1024);const choice=router.routing==='tenant_hash'?(w.partitionSkew>0?(keyed(w.seed,tenant,71)<w.partitionSkew?0:1+Math.floor(keyed(w.seed,tenant,72)*(edges.length-1))):Math.min(edges.length-1,Math.floor(keyed(w.seed,tenant,72)*edges.length))):Math.min(edges.length-1,Math.floor(keyed(w.seed,req.id,500+graph.nodes.findIndex(n=>n.id===id))*edges.length));enter(req,stages.get(edges[choice].to),t);}
  function finish(req, t) { req.status = 'completed'; completed++; latencies.push((t - req.arrival) * 1000); }
  while (heap.a.length) {
    const ev = heap.pop(); if (ev.time > end + 1e-8) break;
    if (ev.kind === 'snapshot') {
      const previous = timeline[timeline.length - 1];
      const phase = phases.find(p => ev.time >= p.start && ev.time < p.end);
      timeline.push({ time: ev.time, offeredRps: phase?.rate || 0, completed, rejected, timedOut, throughput: previous ? completed - previous.completed : 0,
        nodes: Object.fromEntries([...stages].map(([id, s]) => [id, { queue: s.pending, busy: s.busy, servers: s.servers }])) });
      continue;
    }
    const req = requests[ev.id];
    if (ev.kind === 'arrival') {
      req.status = 'active'; heap.push({ time: ev.time + w.deadlineMs / 1000, kind: 'deadline', id: req.id }); if(flow)advance(req,graph.nodes.find(n=>n.type==='client').id,ev.time);else enter(req, stages.get(api.id), ev.time);
    } else if (ev.kind === 'deadline') {
      if (req.status === 'active') {
        req.status = 'timed_out'; timedOut++;
        const s = stages.get(req.stage); s.timedOut++; if (req.queued) { s.pending--; req.queued = false; }
      }
    } else {
      const s = stages.get(ev.node); s.busy--; s.served++;
      while (s.busy < s.servers && s.head < s.queue.length) {
        const queued = requests[s.queue[s.head++]];
        if (queued.status === 'active' && queued.queued && queued.stage === s.id) { s.pending--; service(s, queued, ev.time); }
      }
      if (req.status !== 'active') continue;
      if(flow){if(s.type==='redis'&&req.read){const hit=w.cacheHitRatio*(w.coldStart?Math.min(1,ev.time/5):1);if(keyed(w.seed,req.id,50)<hit){cacheHits++;finish(req,ev.time);}else advance(req,s.id,ev.time);}else advance(req,s.id,ev.time);}
      else if (s.type === 'api') {
        if (req.read && cache) { cacheLookups++; enter(req, stages.get(cache.id), ev.time); }
        else enter(req, stages.get(db.id), ev.time);
      } else if (s.type === 'redis') {
        // Cold-cache scenario explicitly ramps to the assumed hit rate over five seconds.
        const hit = w.cacheHitRatio * (w.coldStart ? Math.min(1, ev.time / 5) : 1);
        if (keyed(w.seed, req.id, 50) < hit) { cacheHits++; finish(req, ev.time); }
        else enter(req, stages.get(db.id), ev.time);
      } else finish(req, ev.time);
    }
  }
  latencies.sort((a, b) => a - b);
  const remaining = count - completed - rejected - timedOut;
  const p95 = percentile(latencies, .95), successRate = count ? completed / count : 0;
  const nodes = [...stages.values()].map(s => ({ id: s.id, type: s.type, arrivals: s.arrivals, served: s.served, maxQueue: s.maxQueue, rejected: s.rejected, timedOut: s.timedOut,
    capacity: s.capacity, utilization: round(s.busyTime / (end * s.servers), 4), averageIncomingRps: round(s.arrivals / w.duration) }));
  const bottleneck = [...nodes].sort((a, b) => (b.rejected + b.timedOut) - (a.rejected + a.timedOut) || b.utilization - a.utilization)[0];
  return {
    simulatorVersion: VERSION, graph, workload: w, provenance: 'simulated', seed: w.seed,
    summary: { generated: count, completed, rejected, timedOut, inFlight: remaining, successRate: round(successRate, 6), failureRate: round(1 - successRate, 6), throughput: round(completed / w.duration),
      p50Ms: round(percentile(latencies, .5)), p95Ms: round(p95), p99Ms: round(percentile(latencies, .99)), sampleCount: latencies.length, cacheHits, cacheLookups,
      observedHitRatio: cacheLookups ? round(cacheHits / cacheLookups, 4) : null, passed: remaining === 0 && p95 !== null && p95 <= w.p95TargetMs && successRate >= w.minSuccessRate, bottleneck: bottleneck?.id },
    nodes, timeline,
    assumptions: [...(graph.partitioning?graph.partitioning.assumptions:[]),...(flow?['Acyclic request routing: read/write conditions; equal split across alternative edges.','Queue and worker flows await processing completion; acknowledgements are not modeled as successful writes.','Response arrows are implicit; no retries, fan-out joins, or network loss are modeled.']:[]), 'Poisson arrivals; independent exponentially distributed service times.', 'Finite FIFO queues; service concurrency determines capacity with mean service time.', 'Requests time out at the configured deadline; already-running service work continues.', 'Cache hits are an explicit workload assumption; cold-start ramp is synthetic.', 'Metrics include a deadline-length drain period. Throughput is normalized to the offered-traffic interval.', 'Latency percentiles describe successful requests. These results are not production benchmarks.']
  };
}
export function evaluatePatch(graph, workload, patch) {
  const candidateGraph = applyPatch(graph, patch);
  return { patch, graph: candidateGraph, result: simulate(candidateGraph, workload) };
}
export function stressSuite(graph, workload) {
  const w = validateWorkload(workload);
  return [
    ...(graph.partitioning?[{name:'Hot-tenant concentration',required:false,result:simulate(graph,{...w,partitionSkew:.5})}]:[]),
    { name: 'Configured scenario', required: true, result: simulate(graph, w) },
    { name: 'Cold cache', required: false, result: simulate(graph, { ...w, coldStart: true, scenario: 'cold' }) },
    { name: 'Write-heavy traffic', required: false, result: simulate(graph, { ...w, readRatio: .2, scenario: 'writes' }) }
  ].map(s => ({ name: s.name, required: s.required, summary: s.result.summary }));
}
