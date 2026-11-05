// Traffic assumptions, never measurements inferred from an uploaded image.
export const SAMPLE_WORKLOADS = [
 {id:'light',title:'Light traffic',description:'A quiet day to establish a baseline.',workload:{scenario:'normal',baseRps:100,peakRps:300,duration:10,readRatio:.9,cacheHitRatio:.95,coldStart:false,dbSlowdown:1,partitionSkew:0,queueLimit:128,deadlineMs:1000,p95TargetMs:300,minSuccessRate:.99,seed:42}},
 {id:'launch',title:'Launch surge',description:'Read-heavy traffic that can overload a single database.',workload:{scenario:'launch',baseRps:120,peakRps:3000,duration:20,readRatio:.9,cacheHitRatio:.97,coldStart:false,dbSlowdown:1,partitionSkew:0,queueLimit:128,deadlineMs:1000,p95TargetMs:300,minSuccessRate:.99,seed:42}},
 {id:'writes',title:'Write-heavy',description:'80% writes; a read cache alone may be insufficient.',workload:{scenario:'writes',baseRps:120,peakRps:2800,duration:20,readRatio:.2,cacheHitRatio:.95,coldStart:false,dbSlowdown:1,partitionSkew:0,queueLimit:128,deadlineMs:1000,p95TargetMs:300,minSuccessRate:.99,seed:42}}
];
