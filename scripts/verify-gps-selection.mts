// Run from server: node --experimental-sqlite --import tsx ../scripts/verify-gps-selection.mts
// Uses an in-memory database and the real region catalogue; never contacts production.
import assert from 'node:assert/strict';
import Fastify from '../server/node_modules/fastify/fastify.js';
import {fileURLToPath} from 'node:url';
import {GameClient} from '../mobile/src/game/client.ts';
import {GameService} from '../server/src/domain/game/application/game-service.ts';
import {GameStore} from '../server/src/domain/game/dao/game-store.ts';
import {RegionService} from '../server/src/domain/region/application/region-service.ts';
import {routes} from '../server/src/domain/game/api/routes.ts';

const app = Fastify();
const regions = new RegionService(fileURLToPath(new URL('../server/data/', import.meta.url)));
const game = new GameService(new GameStore(':memory:'), regions);
routes(app, game, regions);
const store = new Map<string, string>();
const calls: Array<{path: string; body: any}> = [];
const client = new GameClient({
  storage: {getItem: async key => store.get(key) ?? null, setItem: async (key, value) => {store.set(key, value);}},
  fetch: async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({path:url.pathname, body});
    const reply = await app.inject({method:(init?.method || 'GET') as any, url:url.pathname + url.search, payload:body});
    return new Response(reply.body, {status:reply.statusCode, headers:{'Content-Type':'application/json'}});
  },
});
const realNow = Date.now;
try {
  assert.equal(await client.connect('GPS 통합 검증', 'gps'), true);
  let center = regions.get('mois:2623051000').region.center!;
  client.setGpsProvider(async () => ({lat:center.lat,lon:center.lon,accuracyM:8,capturedAt:Date.now(),stepCounter:0,sensorEpoch:'integration'}));
  const busan = await client.findGpsTargets();
  assert.deepEqual(busan?.regions.map(region => region.name), ['부산광역시','부산진구','부전제1동']);
  assert.equal(client.snapshot?.raid, null);
  assert.equal(client.snapshot?.player.totalSteps, 0);
  const initialSession = client.snapshot?.sessionId;
  assert.equal(await client.selectRegion('mois:1114055000'), false, 'A Seoul target must reject a Busan fix');
  assert.equal(client.snapshot?.sessionId, initialSession);
  assert.equal(await client.selectRegion('mois:2623051000'), true, client.error || 'Local attack should recover immediately after outside-target rejection');
  assert.notEqual(client.snapshot?.sessionId, initialSession);
  assert.equal(client.snapshot?.raid?.maxHp, 41727, 'Bujeon population HP reaches the mobile client');
  const browsingSeq = calls.filter(call => call.path.endsWith('/gps') && call.body.sessionId === initialSession).map(call => call.body.seq);
  assert.deepEqual(browsingSeq, [1,2,3]);
  assert.equal(client.snapshot?.player.totalSteps, 0);
  for (const region of busan!.regions) {
    assert.equal(await client.selectRegion(region.id), true, region.name + ': ' + client.error);
  }
  center = regions.get('mois:4111573000').region.center!;
  const suwon = await client.findGpsTargets();
  assert.deepEqual(suwon?.regions.map(region => region.name), ['경기도','수원시','수원시 팔달구','인계동']);
  assert.equal(await client.selectRegion('mois:4111000000'), true, 'Aggregate Suwon city is attackable');
  assert.equal(client.snapshot?.raid?.maxHp, 18081501, 'Basic municipality uses the corrected HP tier');
  assert.equal(client.snapshot?.player.totalSteps, 0);
  const before = calls.length;
  client.setGpsProvider(async () => ({lat:center.lat,lon:center.lon,accuracyM:8,capturedAt:Date.now()-31_000,stepCounter:100,sensorEpoch:'integration'}));
  assert.equal(await client.selectRegion('mois:4111573000'), false, 'Cached stale fixes cannot start attacks');
  assert.equal(calls.length, before, 'Stale refresh does not contact the server');
  // A phone clock ten seconds ahead used to make a genuinely new fix fail
  // the server's five-second future guard. Keep the server clock unmodified.
  const skewedStore = new Map<string,string>();
  const skewed = new GameClient({
    storage:{getItem:async key=>skewedStore.get(key)??null,setItem:async(key,value)=>{skewedStore.set(key,value);}},
    fetch:async(input,init)=>{
      const url=new URL(String(input));
      Date.now=realNow;
      try {
        const reply=await app.inject({method:(init?.method||'GET')as any,url:url.pathname+url.search,payload:init?.body?JSON.parse(String(init.body)):undefined});
        return new Response(reply.body,{status:reply.statusCode,headers:{'Content-Type':'application/json'}});
      } finally { Date.now=()=>realNow()+10_000; }
    },
  });
  Date.now=()=>realNow()+10_000;
  assert.equal(await skewed.connect('시계 차이 검증','gps'),true);
  skewed.setGpsProvider(async()=>({lat:center.lat,lon:center.lon,accuracyM:8,capturedAt:Date.now(),stepCounter:0,sensorEpoch:'clock-test'}));
  assert.equal(await skewed.selectRegion('mois:4111573000'),true,skewed.error||'Clock skew must not reject a fresh local fix');
  skewed.setGpsProvider(async()=>({lat:center.lat,lon:center.lon,accuracyM:8,capturedAt:Date.now()-31_000,stepCounter:0,sensorEpoch:'clock-test'}));
  assert.equal(await skewed.selectRegion('mois:4111573000'),false,'Clock correction must not renew an old fix');
  skewed.dispose();
  Date.now=realNow;
  console.log(JSON.stringify({ok:true,busan:busan!.regions.map(r=>r.name),suwon:suwon!.regions.map(r=>r.name),browsingSeq,totalSteps:client.snapshot?.player.totalSteps}));
} finally {
  Date.now=realNow;
  client.dispose();
  await app.close();
  game.close();
}
