import { DEFAULT_WORKLOAD, validateGraph, validateWorkload } from './model.mjs';
import { architectureSvg } from './diagram.mjs';
const component=(id,label,type,x,y,capacity,concurrency=20)=>({id,label,type,x,y,w:type==='postgres'?150:160,h:type==='postgres'?120:100,capacity,concurrency,replicas:1});
export const EXAMPLES=[
 {id:'shop',title:'Launch traffic',description:'A new SaaS launch: gateway, API, project reads, and transactional writes.',peak:3000,reads:.9,hit:.97},
 {id:'news',title:'Shared workspace surge',description:'A public workspace goes viral. Repeated reads take the database path.',peak:4000,reads:.98,hit:.98},
 {id:'concert',title:'Sync & background writes',description:'Concurrent imports flow through a queue and worker before PostgreSQL.',peak:2800,reads:.2,hit:.95}
].map(info=>{
 let graph=validateGraph({routingVersion:2,title:'Relay · '+info.title,source:'example',nodes:[
 component('client','Web clients','client',25,310,10000),component('gateway','API gateway','gateway',220,310,12000),component('api','Relay API','api',420,310,6000),component('reads','Project service','service',630,120,6000),component('queue','Write queue','queue',420,570,10000),component('worker','Sync worker','worker',650,570,6000),component('db','PostgreSQL','postgres',855,310,600,6)
 ],edges:[{from:'client',to:'gateway'},{from:'gateway',to:'api'},{from:'api',to:'reads',when:'read'},{from:'reads',to:'db',when:'read'},{from:'api',to:'queue',when:'write'},{from:'queue',to:'worker',when:'write'},{from:'worker',to:'db',when:'write'}],uncertainties:[]});
 if(info.id==='news')graph=validateGraph({routingVersion:2,title:'Relay · '+info.title,source:'example',nodes:[
 component('client','Web clients','client',25,310,10000),component('gateway','Gateway','gateway',220,310,12000),component('api','Sharing API','api',420,310,6000),component('auth','Access checks','service',620,310,8000),component('reads','Project reads','service',620,100,7000),component('writer','Update service','service',620,570,6000),component('db','Project DB','postgres',855,200,600,6),component('archive','History DB','postgres',855,570,6000,20)
 ],edges:[{from:'client',to:'gateway'},{from:'gateway',to:'api'},{from:'api',to:'auth'},{from:'auth',to:'reads',when:'read'},{from:'reads',to:'db',when:'read'},{from:'reads',to:'archive',when:'read'},{from:'auth',to:'writer',when:'write'},{from:'writer',to:'db',when:'write'}]});
 if(info.id==='concert')graph=validateGraph({routingVersion:2,title:'Relay · '+info.title,source:'example',nodes:[
 component('client','Sync clients','client',25,310,10000),component('gateway','Gateway','gateway',220,310,12000),component('api','Import API','api',420,310,6000),component('queue','Import queue','queue',220,570,10000),component('validator','Validation','service',420,570,7000),component('worker','Write worker','worker',620,570,6500),component('audit','Audit service','service',820,570,6500),component('db','PostgreSQL','postgres',855,310,600,6)
 ],edges:[{from:'client',to:'gateway'},{from:'gateway',to:'api'},{from:'api',to:'db',when:'read'},{from:'api',to:'queue',when:'write'},{from:'queue',to:'validator',when:'write'},{from:'validator',to:'worker',when:'write'},{from:'worker',to:'audit',when:'write'},{from:'audit',to:'db',when:'write'}]});
 const workload=validateWorkload({...DEFAULT_WORKLOAD,scenario:info.id==='concert'?'writes':'launch',baseRps:120,peakRps:info.peak,readRatio:info.reads,cacheHitRatio:info.hit});
 return {id:info.id,title:info.title,description:info.description,explanation:info.description,sketch:'/examples/'+info.id+'.svg',graph,workload};
});
export function sketchSvg(graph){return architectureSvg(graph);}
