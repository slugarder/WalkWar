// Real catalogue and HTTP routes, simulated GPS samples, in-memory server DB.
// Run from server: node --experimental-sqlite --import tsx ../scripts/verify-record-restoration.mts
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import Fastify from '../server/node_modules/fastify/fastify.js';
import {GameClient} from '../mobile/src/game/client.ts';
import {GameService} from '../server/src/domain/game/application/game-service.ts';
import {GameStore} from '../server/src/domain/game/dao/game-store.ts';
import {RegionService} from '../server/src/domain/region/application/region-service.ts';
import {routes} from '../server/src/domain/game/api/routes.ts';

const app=Fastify();
const regions=new RegionService(fileURLToPath(new URL('../server/data/',import.meta.url)));
const game=new GameService(new GameStore(':memory:'),regions);
routes(app,game,regions);
const values=new Map<string,string>();
const storage={getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value);}};
let requests=0;
const fetcher=async(input:any,init?:RequestInit)=>{
  requests++;
  const url=new URL(String(input));
  const reply=await app.inject({method:(init?.method||'GET')as any,url:url.pathname+url.search,payload:init?.body?JSON.parse(String(init.body)):undefined});
  return new Response(reply.body,{status:reply.statusCode,headers:{'Content-Type':'application/json'}});
};
const first=new GameClient({storage,fetch:fetcher});
const second=new GameClient({storage,fetch:fetcher});
const realNow=Date.now;
let now=realNow();
Date.now=()=>now;
const target=regions.get('mois:2623051000').region;
const sample=(steps:number)=>({lat:target.center!.lat,lon:target.center!.lon,accuracyM:8,capturedAt:now,stepCounter:steps,sensorEpoch:'restoration-test'});
try{
  assert.equal(await first.connect('기록 보존 검증','gps'),true);
  first.setGpsProvider(async()=>sample(0));
  assert.equal(await first.selectRegion(target.id),true);
  first.sendGps(sample(0));await (first as any).tick();
  now+=6000;
  first.sendGps(sample(20));await (first as any).tick();
  assert.equal(first.snapshot?.raid?.selfContribution,20);
  assert.equal(first.snapshot?.player.totalSteps,20);
  assert.equal(first.snapshot?.raid?.hp,41707);
  const player=first.snapshot!.player.id;
  await first.flushLocalRecords();first.dispose();
  const count=requests;
  await second.initialize();
  assert.equal(requests,count,'Opening saved records must not contact the server or resume GPS');
  assert.equal(second.snapshot,null);
  assert.equal(second.savedRecords.gps?.totalSteps,20);
  assert.equal(second.savedRecords.gps?.contribution,20);
  assert.equal(second.savedRecords.gps?.region?.id,target.id);
  assert.equal(second.savedRecords.virtual,undefined);
  assert.equal(await second.connect('기록 보존 검증','gps'),true);
  assert.equal(second.snapshot?.player.id,player);
  assert.equal(second.snapshot?.player.totalSteps,20);
  assert.equal(second.snapshot?.raid,null,'Reconnection must wait for explicit target selection');
  assert.equal(second.savedRecords.gps?.contribution,20);
  second.setGpsProvider(async()=>sample(200));
  assert.equal(await second.selectRegion(target.id),true);
  assert.equal(second.snapshot?.raid?.selfContribution,20);
  assert.equal(second.snapshot?.raid?.hp,41707,'Restoration does not invent steps or damage');
  await second.flushLocalRecords();
  console.log(JSON.stringify({ok:true,samePlayer:true,steps:20,contribution:20,maxHp:41727,hp:41707,gpsRevalidated:true,autoAttack:false}));
}finally{
  Date.now=realNow;
  first.dispose();second.dispose();
  await Promise.all([first.flushLocalRecords(),second.flushLocalRecords()]);
  await app.close();game.close();
}
