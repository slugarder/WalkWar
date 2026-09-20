import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PopulationBalance } from '../src/domain/region/application/population-balance.js';
import { RegionService } from '../src/domain/region/application/region-service.js';
import { GameService } from '../src/domain/game/application/game-service.js';
import { GameStore } from '../src/domain/game/dao/game-store.js';
import { ApiError } from '../src/global/error/api-error.js';
import { setup, fixtureBalance, IDS } from './support/fixture.js';

const productionDir=fileURLToPath(new URL('../data/',import.meta.url));
const catalogue=JSON.parse(readFileSync(join(productionDir,'regions.json'),'utf8')).regions;

test('official population snapshot gives exact unrounded HP and strict tenfold tier separation',()=>{
  const balance=new PopulationBalance(productionDir,catalogue);
  const examples:Record<string,number>={'5175025300':2961,'2623051000':41727,'4833025300':351639,'5011000000':1452447,'4794000000':14550711,'4111000000':18081501,'3600000000':181987224,'4100000000':222136764};
  for(const [code,hp] of Object.entries(examples))assert.equal(balance.get(code).maxHp,hp,code);
  const rows=catalogue.map((r:any)=>balance.raw(r.code));
  assert.equal(rows.length,3848);
  for(const row of rows.filter((r:any)=>r.eligible))assert.ok(Number.isSafeInteger(row.maxHp)&&row.maxHp!>0);
  const values=(tier:string)=>rows.filter((r:any)=>r.tier===tier&&r.eligible).map((r:any)=>r.maxHp);
  assert.ok(Math.min(...values('basic'))>=Math.max(...values('lower'))*10);
  assert.ok(Math.min(...values('metro'))>=Math.max(...values('basic'))*10);
  assert.equal(rows.filter((r:any)=>r.population===0).length,5);
  assert.ok(rows.filter((r:any)=>r.population===0).every((r:any)=>!r.eligible&&r.maxHp===null));
  assert.equal(balance.get('3611000000'),balance.get('3600000000'));
});

test('missing and invalid balance files fail startup instead of using legacy HP',t=>{
  const h=setup(t),file=join(h.data,'population-balance.json'),original=JSON.parse(readFileSync(file,'utf8'));
  for(const mutate of [
    (d:any)=>d.regions.pop(),
    (d:any)=>d.regions.push(d.regions[0]),
    (d:any)=>d.regions[0].population=null,
    (d:any)=>d.regions[0].maxHp=720,
    (d:any)=>d.regions[0].tier='lower',
    (d:any)=>d.metadata.basicBaseHp++,
    (d:any)=>d.aliases['3611000000']='missing',
  ]){
    const invalid=structuredClone(original);mutate(invalid);writeFileSync(file,JSON.stringify(invalid));
    assert.throws(()=>new RegionService(h.data),/Invalid population balance/);
  }
  unlinkSync(file);assert.throws(()=>new RegionService(h.data),/ENOENT/);
});

test('both modes create and reset targets using population HP',t=>{
  const h=setup(t);
  for(const mode of ['virtual','gps'] as const){
    const s=h.start(mode,IDS.busan);
    assert.equal(s.raid.hp,1000);assert.equal(s.raid.maxHp,1000);assert.equal(s.raid.hpRulesVersion,'test-population-v1');
    if(mode==='virtual'){h.move();h.tick();}else{h.gps(100);h.gps(110);}
    assert.ok(h.state().raid.hp<1000);
    const reset=h.game.control(h.id,{sessionId:s.sessionId,requestId:h.request(),action:'reset'});
    assert.equal(reset.raid.hp,1000);assert.equal(reset.raid.maxHp,1000);assert.equal(reset.raid.selfContribution,0);
  }
});

test('legacy damaged paused raids preserve damage, progress, rankings and history exactly once',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);const won=h.victory(),progress=structuredClone(won.progress),history=structuredClone(h.game.history(h.id)),capture=structuredClone(h.game.capture('virtual',h.regions.get(IDS.busan).region));
  h.restart(state=>{
    const raid=state.raids[`virtual:${IDS.busan}`];delete raid.maxHp;delete raid.hpRulesVersion;
    Object.assign(raid,{hp:669,status:'paused',contrib:{[h.id]:20,'npc-hana':31},npcFraction:{'npc-hana':0.25}});
  });
  let s=h.start('virtual',IDS.busan);
  assert.equal(s.raid.maxHp,1000);assert.equal(s.raid.hp,949);assert.equal(s.raid.status,'paused');
  assert.equal(s.raid.selfContribution,20);assert.equal(s.raid.currentPersonal.find((r:any)=>r.id==='npc-hana').steps,31);
  assert.deepEqual(s.progress,progress);assert.deepEqual(h.game.history(h.id),history);assert.deepEqual(h.game.capture('virtual',h.regions.get(IDS.busan).region),capture);
  let originalBackup:any;
  const store=new GameStore(h.db);try{
    const raid=store.load<any>()!.state.raids[`virtual:${IDS.busan}`];assert.equal(raid.hpRulesVersion,'test-population-v1');assert.equal(raid.npcFraction['npc-hana'],0.25);
    originalBackup=store.loadMigrationBackup<any>('population-hp-v1');const original=originalBackup.state.raids[`virtual:${IDS.busan}`];
    assert.equal(original.hp,669);assert.equal(original.maxHp,undefined);assert.equal(original.hpRulesVersion,undefined);assert.equal(original.status,'paused');assert.deepEqual(original.contrib,{[h.id]:20,'npc-hana':31});
  }finally{store.close();}
  h.restart();s=h.start('virtual',IDS.busan);assert.equal(s.raid.hp,949);assert.equal(s.raid.selfContribution,20);assert.equal(s.raid.status,'paused');
  const reopened=new GameStore(h.db);try{reopened.backupMigration('population-hp-v1');assert.deepEqual(reopened.loadMigrationBackup('population-hp-v1'),originalBackup);}finally{reopened.close();}
});

test('a future rule version cannot alter current encounter HP, but reset and defeat use the new snapshot',t=>{
  const h=setup(t);h.start('virtual',IDS.busan);h.start('gps',IDS.busan);
  writeFileSync(join(h.data,'population-balance.json'),JSON.stringify(fixtureBalance(h.regions.regions,'test-population-v2',500)));
  const updated=new RegionService(h.data);
  h.restart(state=>{state.raids[`virtual:${IDS.busan}`].hp=2;},updated);
  const current=h.start('virtual',IDS.busan);
  assert.equal(current.raid.maxHp,1000);assert.equal(current.raid.hp,2);assert.equal(current.raid.hpRulesVersion,'test-population-v1');
  h.move();h.tick();
  const defeated=h.state();assert.equal(defeated.raid.number,2);assert.equal(defeated.raid.maxHp,1500);assert.equal(defeated.raid.hpRulesVersion,'test-population-v2');
  assert.equal(defeated.raid.latestDefeat.maxHp,1000);assert.equal(defeated.raid.latestDefeat.hpRulesVersion,'test-population-v1');
  const gps=h.start('gps',IDS.busan);assert.equal(gps.raid.maxHp,1000);
  const reset=h.game.control(h.id,{sessionId:gps.sessionId,requestId:h.request(),action:'reset'});
  assert.equal(reset.raid.hp,1500);assert.equal(reset.raid.hpRulesVersion,'test-population-v2');
});

test('Sejong alias selects a single metropolitan raid and preserves both historical identities on migration',t=>{
  const h=setup(t);const selected=h.start('virtual',IDS.sejongAlias);
  assert.equal(selected.player.regionId,IDS.sejong);assert.equal(selected.raid.maxHp,h.regions.get(IDS.sejong).region.maxHp);
  h.restart(state=>{
    const canonical=state.raids[`virtual:${IDS.sejong}`];delete canonical.maxHp;delete canonical.hpRulesVersion;canonical.hp=710;canonical.contrib={[h.id]:10};
    const history={id:'old-alias-capture',regionId:IDS.sejongAlias,mode:'virtual',encounterNumber:2,defeatedAt:'2026-09-01T00:00:00Z',personal:[{id:h.id,steps:40}],teams:[{id:'travelers',name:'대한민국 탐험대',country:'KR',rank:1}]};
    state.history.push(history);state.raids[`virtual:${IDS.sejongAlias}`]={...structuredClone(canonical),number:3,hp:700,status:'paused',contrib:{[h.id]:20},latest:history};
    state.players[h.id].states.virtual.session.regionId=IDS.sejongAlias;
  });
  const s=h.start('virtual',IDS.sejongAlias);
  assert.equal(s.player.regionId,IDS.sejong);assert.equal(s.raid.hp,s.raid.maxHp-30);assert.equal(s.raid.selfContribution,30);assert.equal(s.raid.status,'paused');
  assert.equal(h.game.history(h.id,{regionId:IDS.sejong}).total,1);assert.equal(h.game.history(h.id,{regionId:IDS.sejongAlias}).total,1);
  assert.equal(h.game.history(h.id).records[0].regionId,IDS.sejongAlias);
  assert.deepEqual(h.game.capture('virtual',h.regions.get(IDS.sejong).region),h.game.capture('virtual',h.regions.get(IDS.sejongAlias).region));
  const store=new GameStore(h.db);try{const state=store.load<any>()!.state;assert.ok(state.retiredAliasRaids[`virtual:${IDS.sejongAlias}`]);assert.equal(state.raids[`virtual:${IDS.sejongAlias}`],undefined);}finally{store.close();}
  h.restart();assert.equal(h.start('virtual',IDS.sejong).raid.selfContribution,30);
});

test('zero-population or unavailable-boundary targets cannot be attacked',t=>{
  const h=setup(t),regionsFile=join(h.data,'regions.json'),balanceFile=join(h.data,'population-balance.json');
  const cat=JSON.parse(readFileSync(regionsFile,'utf8')),balance=JSON.parse(readFileSync(balanceFile,'utf8'));
  const unavailable=cat.regions.find((r:any)=>r.id===IDS.busan);unavailable.boundaryAvailable=false;
  const row=balance.regions.find((r:any)=>r.code===unavailable.code);row.population=0;row.eligible=false;row.maxHp=null;
  writeFileSync(regionsFile,JSON.stringify(cat));writeFileSync(balanceFile,JSON.stringify(balance));
  const updated=new RegionService(h.data),game=new GameService(new GameStore(join(h.data,'unavailable.sqlite')),updated);
  try{const player=game.join({clientId:'unavailable',displayName:'테스터'});assert.throws(()=>game.session(player.player.id,{mode:'virtual',regionId:IDS.busan,requestId:'test'}),(error:unknown)=>error instanceof ApiError&&error.code==='REGION_UNAVAILABLE');assert.equal(game.state(player.player.id).raid,null);}finally{game.close();}
});

test('a positive-population region with no usable geometry is unavailable in either mode',t=>{
  const h=setup(t),file=join(h.data,'boundaries.geojson'),geo=JSON.parse(readFileSync(file,'utf8'));
  geo.features=geo.features.filter((f:any)=>f.properties.regionId!==IDS.busan);writeFileSync(file,JSON.stringify(geo));
  const updated=new RegionService(h.data),game=new GameService(new GameStore(join(h.data,'no-boundary.sqlite')),updated);
  try{
    const player=game.join({clientId:'no-boundary',displayName:'테스터'});
    assert.equal(updated.get(IDS.busan).region.targetAvailable,false);
    for(const mode of ['virtual','gps'])assert.throws(()=>game.session(player.player.id,{mode,regionId:IDS.busan,requestId:mode}),(error:unknown)=>error instanceof ApiError&&error.code==='REGION_UNAVAILABLE');
  }finally{game.close();}
});
