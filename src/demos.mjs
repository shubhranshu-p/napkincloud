import { DEFAULT_GRAPH, validateGraph, copy } from './model.mjs';
import { EXAMPLES } from './examples.mjs';
import { SAMPLE_WORKLOADS } from './presets.mjs';
export const DEMO_IMAGES = [
 {id:'simple',title:'Simple starter',description:'Three boxes: client → API → PostgreSQL. Start here.',graph:validateGraph({...copy(DEFAULT_GRAPH),title:'Simple starter',routingVersion:2}),workload:copy(SAMPLE_WORKLOADS[1].workload)},
 ...EXAMPLES.map((e,i)=>({...copy(e),title:`Example ${i+1} · ${e.title}`}))
].map(e=>({...e,image:`/demo-images/${e.id}.png`,filename:e.id==='simple'?'00-Simple-starter.png':`0${EXAMPLES.findIndex(x=>x.id===e.id)+1}-${e.id}.png`}));
