import assert from 'node:assert/strict';
import test from 'node:test';
import { setup, IDS } from './support/fixture.js';
import { ApiError } from '../src/global/error/api-error.js';
import { GameStore } from '../src/domain/game/dao/game-store.js';

const code = (expected:string) => (error:unknown) => error instanceof ApiError && error.code === expected;
const rejected = (error:unknown) => error instanceof ApiError && [400,409].includes(error.status);
const gpsSample = (h:ReturnType<typeof setup>,sessionId:string,counter:number,seq:number,options:Record<string,unknown>={}) => h.game.gps(h.id,{sessionId,seq,lat:h.regions.get(IDS.busan).region.center!.lat,lon:h.regions.get(IDS.busan).region.center!.lon,accuracyM:8,capturedAt:h.now(),stepCounter:counter,sensorEpoch:'sensor-one',...options});

test('browsing regions and a stationary virtual session cannot award steps or capture territory',t=>{
  const h=setup(t);
  h.tick(8);
  assert.equal(h.state().player.totalSteps,0);
  h.start('virtual',IDS.busan);
  const initial=h.state();
  h.regions.list({q:'서울'});h.regions.get(IDS.jeju);
  h.regions.map('sido',124,32,132,39,80);
  h.regions.at(h.regions.get(IDS.seoul).region.center!.lat,h.regions.get(IDS.seoul).region.center!.lon);
  h.tick(8);
  assert.equal(h.state().player.totalSteps,0);
  h.move(0,0);h.tick(2);
  assert.equal(h.state().player.totalSteps,0,'zero axes are presence, not walking');
  assert.equal(h.state().progress.points,initial.progress.points);
  assert.equal(h.game.capture('virtual',h.regions.get(IDS.busan).region),null);
});

test('active virtual walking produces a real victory, 100P, rankings, and a frozen capture flag',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);
  assert.equal(h.game.capture('virtual',h.regions.get(IDS.busan).region),null);
  const won=h.victory();
  assert.equal(won.progress.wins,1);assert.equal(won.progress.points,100);
  assert.ok(won.progress.earnedTitles.includes('first-expedition'));
  assert.ok(won.raid!.latestDefeat!.personal.some((r:any)=>r.id===h.id&&r.steps>0&&!r.simulated));
  const first=structuredClone(h.game.capture('virtual',h.regions.get(IDS.busan).region));
  assert.ok(first?.teams.length,'winning team must be present on the capture flag');
  assert.ok(first!.teams.every((team:any)=>team.rank===1),'only first-place teams own the last-defeat flag');
  h.move();h.tick(2);
  assert.deepEqual(h.game.capture('virtual',h.regions.get(IDS.busan).region),first);
  assert.equal(h.state().raid!.number,2);
  assert.ok(h.state().raid!.hp>0);
});

test('capture and wallets remain separate between virtual and GPS modes',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);h.victory();
  const region=h.regions.get(IDS.busan).region;
  const virtualFlag=structuredClone(h.game.capture('virtual',region));
  const gps=h.start('gps',IDS.busan);
  assert.equal(gps.progress.points,0);assert.equal(gps.progress.wins,0);
  assert.equal(h.game.capture('gps',region),null);
  h.gps(100);
  for(let counter=110;counter<=2100&&h.state().progress.wins===0;counter+=10)h.gps(counter);
  assert.equal(h.state().progress.wins,1,'GPS sensor steps must produce a real contributed victory');
  assert.equal(h.state().progress.points,100);
  const gpsFlag=structuredClone(h.game.capture('gps',region));
  assert.ok(gpsFlag?.teams.length);
  assert.deepEqual(h.game.capture('virtual',region),virtualFlag);
  const resumed=h.start('virtual',IDS.busan);
  assert.equal(resumed.progress.points,100);assert.equal(resumed.progress.wins,1);
  h.move();h.tick(2);
  assert.deepEqual(h.game.capture('gps',region),gpsFlag);
});

test('input expiration stops unattended virtual contributions',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);h.move();h.tick();
  assert.ok(h.state().player.totalSteps>0);
  h.advance(2000);h.game.tick();
  const stopped=h.state().player.totalSteps;
  h.tick(10);assert.equal(h.state().player.totalSteps,stopped);
});

test('purchases reject insufficient funds and apply the same request only once',t=>{
  const h=setup(t);let s=h.start('virtual',IDS.busan);
  assert.throws(()=>h.game.purchase(h.id,{sessionId:s.sessionId,requestId:'poor',itemId:'cafe-postcard'}),code('INSUFFICIENT_POINTS'));
  assert.equal(h.state().progress.points,0);
  s=h.victory();
  const purchase={sessionId:s.sessionId,requestId:'purchase-once',itemId:'cafe-postcard'};
  const bought=h.game.purchase(h.id,purchase);
  assert.equal(bought.progress.points,70);
  const replay=h.game.purchase(h.id,purchase);
  assert.equal(replay.progress.points,70);
  assert.deepEqual(replay.progress.ownedItems,['cafe-postcard']);
  assert.throws(()=>h.game.purchase(h.id,{...purchase,itemId:'wave-pin'}),code('REQUEST_CONFLICT'));
  assert.throws(()=>h.game.purchase(h.id,{...purchase,requestId:'purchase-twice'}),code('ITEM_ALREADY_OWNED'));
  assert.equal(h.state().progress.points,70);
});

test('equipment rejects unowned items and an owned item in the wrong slot',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);const s=h.victory();
  assert.throws(()=>h.game.equipment(h.id,{sessionId:s.sessionId,requestId:'unowned',slot:'badge',itemId:'wave-pin'}),code('NOT_OWNED'));
  h.game.purchase(h.id,{sessionId:s.sessionId,requestId:'buy-frame',itemId:'cafe-postcard'});
  assert.throws(()=>h.game.equipment(h.id,{sessionId:s.sessionId,requestId:'wrong-slot',slot:'badge',itemId:'cafe-postcard'}),rejected);
  assert.equal(h.state().progress.equipment.badge,null);
  assert.equal(h.state().progress.points,70);
});

test('purchased equipment, earned title, points and receipts survive a SQLite restart',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);const s=h.victory();
  const purchase={sessionId:s.sessionId,requestId:'persist-purchase',itemId:'cafe-postcard'};
  h.game.purchase(h.id,purchase);
  h.game.equipment(h.id,{sessionId:s.sessionId,requestId:'persist-frame',slot:'frame',itemId:'cafe-postcard'});
  h.game.equipment(h.id,{sessionId:s.sessionId,requestId:'persist-title',slot:'title',itemId:'first-expedition'});
  const before=structuredClone(h.state().progress);
  const restored=h.restart();
  assert.equal(restored.player.id,h.id);
  assert.deepEqual(restored.progress,before);
  const receiptStore=new GameStore(h.db);
  try { assert.ok(receiptStore.receipt(h.id,'persist-purchase'),'idempotency receipt must survive restart'); }
  finally { receiptStore.close(); }
  const resumed=h.start('virtual',IDS.busan);
  assert.equal(resumed.progress.equipment.frame,'cafe-postcard');
  assert.equal(resumed.progress.equipment.title,'first-expedition');
  assert.equal(resumed.progress.points,70);
  const gps=h.start('gps',IDS.busan);
  assert.deepEqual(gps.progress.ownedItems,[]);
  assert.equal(gps.progress.equipment.frame,null);assert.equal(gps.progress.equipment.title,null);
});

test('titles unlock from three wins in one region and five distinct 읍면동 wins',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);
  h.victory();h.victory();
  assert.ok(!h.state().progress.earnedTitles.includes('local-guardian'));
  const third=h.victory();
  assert.ok(third.progress.earnedTitles.includes('local-guardian'));
  for(const region of [IDS.busanNext,IDS.seoul,IDS.daejeon,IDS.jeju]){
    h.start('virtual',region);h.victory();
  }
  const progress=h.state().progress;
  assert.equal(progress.wins,7);assert.equal(progress.distinctRegions,5);
  assert.ok(progress.earnedTitles.includes('national-explorer'));
  assert.equal(new Set(progress.earnedTitles).size,progress.earnedTitles.length);
});

test('all defeat history records are retained while the capture flag advances to the latest',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);
  const first=h.victory().raid!.latestDefeat!;
  const second=h.victory().raid!.latestDefeat!;
  assert.notEqual(first.id,second.id);
  const history=h.game.history(h.id,{regionId:IDS.busan,offset:0,limit:30});
  assert.equal(history.total,2);assert.equal(history.records.length,2);
  assert.ok(history.records.some((r:any)=>r.id===first.id));
  assert.ok(history.records.some((r:any)=>r.id===second.id));
  assert.equal(h.game.capture('virtual',h.regions.get(IDS.busan).region)!.encounterNumber,2);
  assert.deepEqual(first,h.game.history(h.id,{regionId:IDS.busan}).records.find((r:any)=>r.id===first.id));
});

test('GPS targeting requires a verified fix and browsing samples never auto-attack',t=>{
  const h=setup(t);
  assert.throws(()=>h.game.session(h.id,{requestId:h.request(),mode:'gps',regionId:IDS.busan}),code('GPS_NOT_READY'));
  h.start('gps');
  h.gps(100);h.gps(110);
  assert.equal(h.state().player.totalSteps,0);
  assert.equal(h.state().player.regionId,null);
  assert.equal(h.game.capture('gps',h.regions.get(IDS.busan).region),null);
  const selected=h.game.session(h.id,{requestId:h.request(),mode:'gps',regionId:IDS.busan});
  assert.equal(selected.player.regionId,IDS.busan);
  assert.equal(selected.player.totalSteps,0);
});

test('GPS first sample establishes baseline and duplicate or stale sequences never add steps',t=>{
  const h=setup(t);h.start('gps',IDS.busan);
  assert.equal(h.gps(100).player.totalSteps,0);
  assert.equal(h.gps(110).player.totalSteps,10);
  assert.equal(h.gps(120,{seq:2}).player.totalSteps,10);
  assert.equal(h.gps(130,{seq:1}).player.totalSteps,10);
});

test('GPS step-counter batches are accepted after zero-step samples accumulate bounded residence credit',t=>{
  const h=setup(t);const s=h.start('gps',IDS.busan);h.gps(100);
  for(let seq=2;seq<=11;seq++){h.advance(1000);gpsSample(h,s.sessionId,100,seq);}
  h.advance(1000);
  const batch=gpsSample(h,s.sessionId,120,12);
  assert.equal(batch.player.totalSteps,20,'a delayed Android step-counter batch must use accumulated valid residence time');
  h.advance(1000);
  assert.equal(gpsSample(h,s.sessionId,120,13).player.totalSteps,20,'repeated zero-step samples must not award steps');
});

test('GPS residence credit has one initial burst and a hard 120-step cap',t=>{
  const h=setup(t);const s=h.start('gps',IDS.busan);h.gps(100);
  const first=gpsSample(h,s.sessionId,104,2);
  assert.equal(first.player.totalSteps,4);
  assert.equal(gpsSample(h,s.sessionId,108,3).player.totalSteps,4,'same-time packets cannot receive a fresh burst each time');

  const capped=setup(t);const cappedSession=capped.start('gps',IDS.busan);capped.gps(100);capped.advance(29000);
  assert.equal(gpsSample(capped,cappedSession.sessionId,220,2).player.totalSteps,120,'valid residence credit is capped at 120 steps');
});

test('GPS long gaps and excessive batches reset credit without backfilling, then resume at the normal rate',t=>{
  const h=setup(t);const s=h.start('gps',IDS.busan);h.gps(100);
  h.advance(31000);
  assert.equal(gpsSample(h,s.sessionId,220,2).player.totalSteps,0,'a long background gap establishes a fresh baseline');
  h.advance(1000);
  assert.equal(gpsSample(h,s.sessionId,224,3).player.totalSteps,4,'post-gap movement uses only fresh residence credit');
  h.advance(1000);
  assert.equal(gpsSample(h,s.sessionId,1000,4).player.totalSteps,4,'an excessive rate jump is discarded');
  h.advance(1000);
  assert.equal(gpsSample(h,s.sessionId,1000,5).player.totalSteps,4,'discarded jumps do not become backfill');
});

test('stale, inaccurate and sensor-reset GPS samples cannot grant accumulated steps',t=>{
  const h=setup(t);h.start('gps',IDS.busan);
  h.gps(100);
  const before=h.state().player.totalSteps;
  assert.equal(h.gps(120,{capturedAt:h.now()-60000}).player.totalSteps,before);
  assert.equal(h.gps(140,{accuracyM:200}).player.totalSteps,before);
  assert.equal(h.gps(5,{sensorEpoch:'sensor-two'}).player.totalSteps,before);
  assert.equal(h.gps(3,{sensorEpoch:'sensor-two'}).player.totalSteps,before);
});

test('leaving and reentering the selected GPS region rebaselines without cross-region awards',t=>{
  const h=setup(t);h.start('gps',IDS.busan);
  const outside=h.regions.get(IDS.busanNext).region.center!;
  h.gps(100);assert.equal(h.gps(110).player.totalSteps,10);
  assert.equal(h.gps(120,{lat:outside.lat,lon:outside.lon}).player.totalSteps,10);
  assert.equal(h.gps(130).player.totalSteps,10,'first sample back inside must only rebaseline');
  assert.equal(h.gps(140).player.totalSteps,20);
});

test('a GPS session cannot attack a browsed region outside its verified location',t=>{
  const h=setup(t);h.start('gps',IDS.busan);h.gps(100);h.gps(110);
  const before=h.state().player.totalSteps;
  const target=h.regions.get(IDS.seoul).region;
  h.regions.get(target.id);h.regions.map('emd',126,37,128,38,80);
  assert.equal(h.state().player.regionId,IDS.busan);
  assert.equal(h.state().player.totalSteps,before);
  assert.equal(h.game.capture('gps',target),null);
  assert.throws(()=>h.game.session(h.id,{requestId:h.request(),mode:'gps',regionId:IDS.seoul}),code('GPS_OUTSIDE_REGION'));
  assert.equal(h.state().player.regionId,IDS.busan,'rejected selection keeps the original session');
});

test('paused GPS samples cannot contribute and resume cannot backfill paused steps',t=>{
  const h=setup(t);const s=h.start('gps',IDS.busan);h.gps(100);
  h.game.control(h.id,{sessionId:s.sessionId,requestId:'pause',action:'pause'});
  assert.equal(h.gps(110).player.totalSteps,0);
  h.game.control(h.id,{sessionId:s.sessionId,requestId:'resume',action:'resume'});
  assert.equal(h.gps(120).player.totalSteps,0);
  assert.equal(h.gps(130).player.totalSteps,10);
});

test('an explicitly selected enclosing city accepts GPS from a descendant ward',t=>{
  const h=setup(t);h.start('gps',IDS.suwonCity);
  const point=h.regions.get(IDS.suwon).region.center!;
  h.gps(100,{lat:point.lat,lon:point.lon});
  const result=h.gps(110,{lat:point.lat,lon:point.lon});
  assert.equal(result.player.totalSteps,10);assert.equal(result.player.regionId,IDS.suwonCity);
});

test('reset clears current encounter contribution but preserves rewards and last capture',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);h.victory();
  const flag=structuredClone(h.game.capture('virtual',h.regions.get(IDS.busan).region));
  h.move();h.tick();
  const before=h.state(), points=before.progress.points;
  assert.ok(before.raid!.selfContribution>0);
  const reset=h.game.control(h.id,{sessionId:before.sessionId,requestId:'reset',action:'reset'});
  assert.equal(reset.raid!.hp,reset.raid!.maxHp);
  assert.equal(reset.raid!.selfContribution,0);
  assert.equal(reset.progress.points,points);assert.equal(reset.progress.wins,1);
  assert.deepEqual(h.game.capture('virtual',h.regions.get(IDS.busan).region),flag);
});

