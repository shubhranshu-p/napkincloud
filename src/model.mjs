export const VERSION = '0.7.0';
export const DEFAULT_GRAPH = {
  title: 'The launch-day shop',
  source: 'example',
  nodes: [
    { id: 'client', label: 'Customers', type: 'client', x: 70, y: 340, w: 210, h: 150, capacity: 10000, concurrency: 1, replicas: 1 },
    { id: 'api', label: 'Shop API', type: 'api', x: 390, y: 340, w: 210, h: 150, capacity: 5000, concurrency: 20, replicas: 1 },
    { id: 'db', label: 'PostgreSQL', type: 'postgres', x: 720, y: 340, w: 210, h: 150, capacity: 600, concurrency: 6, replicas: 1 }
  ],
  edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db' }],
  uncertainties: []
};
export const DEFAULT_WORKLOAD = {
  scenario: 'launch', baseRps: 400, peakRps: 3000, duration: 20,
  readRatio: 0.9, cacheHitRatio: 0.95, coldStart: false,
  dbSlowdown: 1, partitionSkew: 0, queueLimit: 128, deadlineMs: 1000,
  p95TargetMs: 300, minSuccessRate: 0.99, seed: 42
};
export const copy = (value) => JSON.parse(JSON.stringify(value));
export function numberIn(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}
export function validateGraph(input) {
  if(input?.routingVersion===2)return validateFlowGraph(input);
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new Error('Architecture needs nodes and edges.');
  if (input.nodes.length < 3 || input.nodes.length > 4) throw new Error('This version supports one client, one API, one PostgreSQL database, and an optional Redis cache.');
  const g = copy(input);
  const ids = new Set();
  const types = new Set();
  for (const n of g.nodes) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(n.id) || ids.has(n.id)) throw new Error('Node IDs must be unique, short identifiers.');
    if (!['client', 'api', 'postgres', 'redis'].includes(n.type) || types.has(n.type)) throw new Error('Use one component of each supported type: client, API, PostgreSQL, optional Redis.');
    if (typeof n.label !== 'string' || !n.label.trim() || n.label.length > 80) throw new Error('Each component needs a label of 1–80 characters.');
    ids.add(n.id); types.add(n.type);
    for (const k of ['x', 'y']) numberIn(n[k], 0, 1000, `${n.label} ${k}`);
    for (const k of ['w', 'h']) numberIn(n[k], 30, 700, `${n.label} ${k}`);
    if (n.x + n.w > 1010 || n.y + n.h > 1010) throw new Error(`${n.label} falls outside the sketch.`);
    n.capacity = n.capacity ?? ({ client: 10000, api: 5000, postgres: 600, redis: 10000 }[n.type]);
    n.concurrency = n.concurrency ?? ({ client: 1, api: 20, postgres: 6, redis: 10 }[n.type]);
    n.replicas = n.replicas ?? 1;
    numberIn(n.capacity, 1, 100000, 'Capacity');
    numberIn(n.concurrency, 1, 128, 'Concurrency');
    numberIn(n.replicas, 1, 4, 'Replicas');
    if (!Number.isInteger(n.concurrency) || !Number.isInteger(n.replicas)) throw new Error('Concurrency and replicas must be integers.');
    if (n.type !== 'api' && n.replicas !== 1) throw new Error('Only API replicas are supported in this version.');
  }
  if (!['client', 'api', 'postgres'].every(t => types.has(t))) throw new Error('Include a client, an API, and a PostgreSQL database.');
  const byType = Object.fromEntries(g.nodes.map(n => [n.type, n.id]));
  const allowed = new Set([`${byType.client}>${byType.api}`, `${byType.api}>${byType.postgres}`]);
  if (byType.redis) { allowed.add(`${byType.api}>${byType.redis}`); allowed.add(`${byType.redis}>${byType.postgres}`); }
  const seen = new Set();
  for (const e of g.edges) {
    const key = `${e.from}>${e.to}`;
    if (!ids.has(e.from) || !ids.has(e.to) || !allowed.has(key) || seen.has(key)) throw new Error('Use directed client → API → database paths, with optional API → Redis → database for reads.');
    seen.add(key);
  }
  const required = [`${byType.client}>${byType.api}`, `${byType.api}>${byType.postgres}`];
  if (byType.redis) required.push(`${byType.api}>${byType.redis}`, `${byType.redis}>${byType.postgres}`);
  if (required.some(e => !seen.has(e))) throw new Error('Connect client → API → database. With Redis, also connect API → Redis → database; writes bypass Redis.');
  g.title = String(g.title || 'Untitled architecture').slice(0, 120);
  g.uncertainties = Array.isArray(g.uncertainties) ? g.uncertainties.map(x => String(x).slice(0, 250)).slice(0, 8) : [];
  return g;
}
export function flowTargets(graph, id, read) {
  const outgoing=graph.edges.filter(e=>e.from===id),specific=outgoing.filter(e=>e.when===(read?'read':'write'));
  return specific.length?specific:outgoing.filter(e=>!e.when||e.when==='all');
}
export function validateFlowGraph(input) {
  if(!Array.isArray(input.nodes)||!Array.isArray(input.edges)||input.nodes.length<3||input.nodes.length>16||input.edges.length>40)throw new Error('Flow diagrams support 3–16 components and at most 40 connections.');
  const g=copy(input),ids=new Set(),types=['client','gateway','api','service','queue','worker','postgres','redis'];
  for(const n of g.nodes){
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(n.id)||ids.has(n.id))throw new Error('Node IDs must be unique, short identifiers.');ids.add(n.id);
    if(!types.includes(n.type))throw new Error('Unsupported component. Use clients, gateways, APIs, services, queues, workers, PostgreSQL, or Redis.');
    if(typeof n.label!=='string'||!n.label.trim()||n.label.length>80)throw new Error('Each component needs a label of 1–80 characters.');
    for(const k of ['x','y'])numberIn(n[k],0,1000,'Position');for(const k of ['w','h'])numberIn(n[k],30,700,'Size');
    if(n.x+n.w>1010||n.y+n.h>1010)throw new Error('Component outside the diagram.');
    n.capacity??=({client:10000,gateway:12000,api:5000,service:5000,queue:10000,worker:3000,postgres:600,redis:10000})[n.type];n.concurrency??=n.type==='postgres'?6:20;n.replicas??=1;
    numberIn(n.capacity,1,100000,'Capacity');numberIn(n.concurrency,1,128,'Concurrency');numberIn(n.replicas,1,4,'Replicas');
    if(!Number.isInteger(n.concurrency)||!Number.isInteger(n.replicas))throw new Error('Concurrency and replicas must be integers.');
    if(!['api','service','worker','gateway'].includes(n.type)&&n.replicas!==1)throw new Error('Only processing services may have replicas.');
  }
  if(g.nodes.filter(n=>n.type==='client').length!==1||!g.nodes.some(n=>n.type==='api')||!g.nodes.some(n=>n.type==='postgres'))throw new Error('Include exactly one client source, an API, and PostgreSQL.');
  const byId=Object.fromEntries(g.nodes.map(n=>[n.id,n])),seen=new Set();
  for(const e of g.edges){const key=e.from+'>'+e.to+':'+(e.when||'all');if(!ids.has(e.from)||!ids.has(e.to)||e.from===e.to||seen.has(key))throw new Error('Use unique directed connections between existing components.');seen.add(key);if(!['all','read','write'].includes(e.when||'all'))throw new Error('Route conditions must be all, read, or write.');if(byId[e.to].type==='client'||byId[e.from].type==='postgres')throw new Error('Client is the source; PostgreSQL is a terminal store.');}
  for(const cache of g.nodes.filter(n=>n.type==='redis')){const exits=g.edges.filter(e=>e.from===cache.id);if(exits.some(e=>byId[e.to].type!=='postgres'&&byId[e.to].routing!=='tenant_hash'))throw new Error('Cache hits complete reads; cache misses must go directly to PostgreSQL. Post-cache processing is not supported.');}
  for(const router of g.nodes.filter(n=>n.routing==='tenant_hash')){const targets=g.edges.filter(e=>e.from===router.id);if(router.type!=='gateway'||targets.length<2||targets.length>8||targets.some(e=>byId[e.to].type!=='postgres'||e.when&&e.when!=='all'))throw new Error('Tenant routers must route to 2–8 independent PostgreSQL partitions.');}
  if(g.partitioning){const p=g.partitioning,router=byId[p.routerId];if(!router||router.routing!=='tenant_hash'||!Number.isInteger(p.partitions)||typeof p.originalLabel!=='string'||!p.originalLabel.trim()||p.originalLabel.length>80||!Array.isArray(p.databaseIds)||p.databaseIds.length!==p.partitions||p.partitions<2||p.partitions>8||new Set(p.databaseIds).size!==p.partitions||!p.databaseIds.includes(p.sourceDatabaseId)||p.databaseIds.some(id=>byId[id]?.type!=='postgres'||byId[id].partitionGroup!==p.sourceDatabaseId||byId[id].capacity!==p.capacityPerPartition||(p.concurrencyPerPartition!==undefined&&byId[id].concurrency!==p.concurrencyPerPartition)))throw new Error('Invalid partition group.');const exits=g.edges.filter(e=>e.from===p.routerId);if(exits.length!==p.partitions||exits.some(e=>!p.databaseIds.includes(e.to)))throw new Error('Partition routes must match the independent stores.');}
  const visiting=new Set(),visited=new Set();function walk(id){if(visiting.has(id))throw new Error('Use a directed acyclic request flow; response arrows are implicit.');if(visited.has(id))return;visiting.add(id);g.edges.filter(e=>e.from===id).forEach(e=>walk(e.to));visiting.delete(id);visited.add(id);}g.nodes.forEach(n=>walk(n.id));
  const client=g.nodes.find(n=>n.type==='client');const reachable=new Set();function traverse(id,read){const key=id+read;if(reachable.has(key))return;reachable.add(key);const n=byId[id];if(!read&&n.type==='redis')throw new Error('Writes must bypass Redis.');const edges=flowTargets(g,id,read);if(!edges.length&&n.type!=='postgres')throw new Error(n.label+' has no '+(read?'read':'write')+' route to PostgreSQL.');for(const e of edges)traverse(e.to,read);}traverse(client.id,true);traverse(client.id,false);
  if(g.nodes.some(n=>!reachable.has(n.id+true)&&!reachable.has(n.id+false)))throw new Error('Every component must belong to a client-to-database request path.');
  g.title=String(g.title||'Architecture').slice(0,120);g.uncertainties=Array.isArray(g.uncertainties)?g.uncertainties.map(x=>String(x).slice(0,250)).slice(0,8):[];g.corrections=Array.isArray(g.corrections)?g.corrections.map(x=>String(x).slice(0,250)).slice(0,20):[];
  return g;
}
export function validateWorkload(input = {}) {
  const w = { ...DEFAULT_WORKLOAD, ...input };
  if (!['normal', 'launch', 'writes', 'brownout', 'cold'].includes(w.scenario)) throw new Error('Unknown scenario.');
  const bounds = { baseRps: [1, 8000], peakRps: [1, 8000], duration: [5, 30], readRatio: [0, 1], cacheHitRatio: [0, 1], dbSlowdown: [0.1, 1], partitionSkew: [0, 1], queueLimit: [0, 1000], deadlineMs: [20, 5000], p95TargetMs: [1, 5000], minSuccessRate: [0.5, 1], seed: [1, 2147483646] };
  for (const [key, [min, max]] of Object.entries(bounds)) numberIn(w[key], min, max, key);
  if (![w.queueLimit, w.seed].every(Number.isInteger)) throw new Error('Queue limit and seed must be integers.');
  if (typeof w.coldStart !== 'boolean') throw new Error('coldStart must be boolean.');
  if (w.duration * Math.max(w.baseRps, w.peakRps) > 160000) throw new Error('Reduce traffic or duration: a run supports at most 160,000 expected arrivals.');
  return w;
}
export function applyPatch(graph, patch) {
  const g = validateGraph(graph);
  if(g.routingVersion===2)return applyFlowPatch(g,patch);
  if (!patch || !['add_cache', 'scale_api'].includes(patch.action)) throw new Error('Supported changes are add_cache and scale_api. Workload and capacity assumptions are protected.');
  const permitted = patch.action === 'add_cache' ? ['action'] : ['action', 'replicas'];
  if (Object.keys(patch).some(k => !permitted.includes(k))) throw new Error('Patch contains protected or unknown fields.');
  if (patch.action === 'scale_api') {
    numberIn(patch.replicas, 2, 4, 'API replicas');
    if (!Number.isInteger(patch.replicas)) throw new Error('Replicas must be an integer.');
    g.nodes.find(n => n.type === 'api').replicas = patch.replicas;
  } else {
    if (g.nodes.some(n => n.type === 'redis')) throw new Error('The architecture already includes a Redis cache.');
    let id = 'cache'; while (g.nodes.some(n => n.id === id)) id += '_';
    g.nodes.push({ id, label: 'Redis cache', type: 'redis', x: 500, y: 740, w: 220, h: 130, capacity: 10000, concurrency: 10, replicas: 1 });
    g.edges.push({ from: g.nodes.find(n => n.type === 'api').id, to: id }, { from: id, to: g.nodes.find(n => n.type === 'postgres').id });
  }
  return validateGraph(g);
}

export function applyFlowPatch(graph,patch){
 const g=copy(graph);if(!patch||!['add_cache','scale_api','partition_database'].includes(patch.action))throw new Error('Supported changes are add_cache, scale_api, and partition_database.');
 const allowed=patch.action==='add_cache'?['action']:patch.action==='partition_database'?['action','partitions','databaseId']:['action','replicas'];if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new Error('Patch contains protected or unknown fields.');
 if(patch.action==='partition_database')return partitionDatabase(g,patch);
 if(patch.action==='scale_api'){numberIn(patch.replicas,2,4,'API replicas');if(!Number.isInteger(patch.replicas))throw new Error('Replicas must be an integer.');g.nodes.filter(n=>n.type==='api').forEach(n=>n.replicas=patch.replicas);}
 else {if(g.nodes.some(n=>n.type==='redis'))throw new Error('The architecture already includes a Redis cache.');const readReachable=new Set();function visit(id){if(readReachable.has(id))return;readReachable.add(id);flowTargets(g,id,true).forEach(e=>visit(e.to));}visit(g.nodes.find(n=>n.type==='client').id);const edge=g.edges.find(e=>readReachable.has(e.from)&&flowTargets(g,e.from,true).includes(e)&&g.nodes.find(n=>n.id===e.to)?.type==='postgres');if(!edge)throw new Error('No eligible database read path can be cached.');
  const outgoing=g.edges.filter(e=>e.from===edge.from),hadSpecificReads=outgoing.some(e=>e.when==='read'),hadSpecificWrites=outgoing.some(e=>e.when==='write'),edgeIsAll=!edge.when||edge.when==='all',remainingAll=outgoing.filter(e=>(!e.when||e.when==='all')&&e!==edge);
  let id='cache';while(g.nodes.some(n=>n.id===id))id+='_';const db=g.nodes.find(n=>n.id===edge.to);g.nodes.push({id,label:'Redis cache',type:'redis',x:Math.min(830,Math.max(50,db.x-30)),y:50,w:170,h:110,capacity:10000,concurrency:10,replicas:1});g.edges=g.edges.filter(e=>e!==edge);if(edgeIsAll&&!hadSpecificWrites)g.edges.push({from:edge.from,to:edge.to,when:'write'});g.edges.push({from:edge.from,to:id,when:'read'},{from:id,to:edge.to,when:'read'});
  if(!(hadSpecificReads&&hadSpecificWrites))for(const r of remainingAll){g.edges=g.edges.filter(e=>e!==r);if(!hadSpecificReads)g.edges.push({from:r.from,to:r.to,when:'read'});if(!hadSpecificWrites)g.edges.push({from:r.from,to:r.to,when:'write'});}
 }
 return validateFlowGraph(g);
}

export function partitionDatabase(graph,patch){
 const g=copy(graph);if(g.partitioning)throw new Error('Only one partition group is supported per architecture.');numberIn(patch.partitions,2,8,'Partitions');if(!Number.isInteger(patch.partitions))throw new Error('Partitions must be an integer.');
 if(g.nodes.length+patch.partitions>16)throw new Error('Partitioning would exceed the 16-component limit.');
 const db=patch.databaseId?g.nodes.find(n=>n.id===patch.databaseId&&n.type==='postgres'):[...g.nodes].filter(n=>n.type==='postgres'&&!n.partitionGroup).sort((a,b)=>a.capacity-b.capacity)[0];
 if(!db||db.partitionGroup)throw new Error('Choose an unpartitioned PostgreSQL store.');
 const uniqueId=suffix=>{const base=db.id.slice(0,30)+suffix;let id=base,serial=1;while(g.nodes.some(n=>n.id===id))id=base+'_'+serial++;return id;};const routerId=uniqueId('_router');
 const slots=[[650,430],[650,300],[650,730],[430,30],[30,30]],slot=slots.find(([x,y])=>!g.nodes.some(n=>x<n.x+n.w+12&&x+140+12>n.x&&y<n.y+n.h+12&&y+100+12>n.y))||[650,430];
 const router={id:routerId,label:'Tenant router',type:'gateway',routing:'tenant_hash',x:slot[0],y:slot[1],w:140,h:100,capacity:10000,concurrency:20,replicas:1};
 g.edges=g.edges.map(e=>e.to===db.id?{...e,to:routerId}:e);g.nodes.push(router);
 const originalLabel=db.label,group=db.id;db.partitionGroup=group;db.partitionIndex=1;db.label=originalLabel.slice(0,77)+' 1';
 const ids=[db.id];for(let i=2;i<=patch.partitions;i++){const id=uniqueId('_p'+i);g.nodes.push({...db,id,label:originalLabel.slice(0,77)+' '+i,partitionIndex:i});ids.push(id);}
 for(const id of ids)g.edges.push({from:routerId,to:id});
 g.partitioning={routerId,databaseIds:ids,sourceDatabaseId:group,originalLabel,partitions:patch.partitions,capacityPerPartition:db.capacity,concurrencyPerPartition:db.concurrency,scheme:'uniform_tenant_hash',assumptions:['Stable tenant-key routing with a uniform tenant distribution.','Each partition has the original database capacity and concurrency; these are additional independent stores, not write replicas.','Cross-partition transactions, migration cost, and routing-table failures are not simulated.']};
 return validateFlowGraph(g);
}
