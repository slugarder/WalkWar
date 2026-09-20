import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { GameService } from '../../src/domain/game/application/game-service.js';
import { GameStore } from '../../src/domain/game/dao/game-store.js';
import { RegionService } from '../../src/domain/region/application/region-service.js';

export const IDS = {
  busan: 'mois:2623051000',
  busanNext: 'mois:2623052000',
  seoul: 'mois:1114055000',
  daejeon: 'mois:3017063000',
  jeju: 'mois:5011058000',
  suwon: 'mois:4111573000',
  suwonCity: 'mois:4111000000',
  suwonWard: 'mois:4111500000',
  sejong: 'mois:3600000000',
  sejongAlias: 'mois:3611000000',
};
const dataDirectory = fileURLToPath(new URL('../../data/', import.meta.url));
const catalogue = JSON.parse(readFileSync(join(dataDirectory, 'regions.json'), 'utf8'));
const boundaries = JSON.parse(readFileSync(join(dataDirectory, 'boundaries.geojson'), 'utf8'));
const sourceById = new Map<string, any>(catalogue.regions.map((r:any) => [r.id,r]));
const selected = new Set<string>();
for (const id of Object.values(IDS)) {
  let region = sourceById.get(id);
  while (region) { selected.add(region.id); region = sourceById.get(region.parentId); }
}
const fixtureCatalogue = { metadata: catalogue.metadata, regions: catalogue.regions.filter((r:any)=>selected.has(r.id)) };
const fixtureBoundaries = { type:'FeatureCollection', features:boundaries.features.filter((f:any)=>selected.has(f.properties.regionId)) };

// Deliberately small, explicit population fixtures keep gameplay tests practical.
// The production population snapshot is independently tested in population-balance.test.ts.
export function fixtureBalance(regions:any[],rulesVersion='test-population-v1',population=100){
  const rows=regions.map(region=>({code:region.code,population,tier:region.code==='3611000000'?'alias':region.level==='sido'?'metro':region.level==='emd'||sourceById.get(region.parentId)?.level==='sigungu'||['5011000000','5013000000'].includes(region.code)?'lower':'basic',eligible:region.code!=='3611000000'&&region.boundaryAvailable!==false,maxHp:null as number|null}));
  const maximum=(tier:string)=>Math.max(0,...rows.filter(r=>r.tier===tier&&r.eligible).map(r=>r.maxHp!));
  for(const row of rows)if(row.tier==='lower'&&row.eligible)row.maxHp=Math.max(1000,row.population*3);
  const lowerMaxHp=maximum('lower'),basicBaseHp=Math.max(10000,lowerMaxHp*10);
  for(const row of rows)if(row.tier==='basic'&&row.eligible)row.maxHp=basicBaseHp+row.population*3;
  const basicMaxHp=maximum('basic'),metroBaseHp=Math.max(100000,basicMaxHp*10);
  for(const row of rows)if(row.tier==='metro'&&row.eligible)row.maxHp=metroBaseHp+row.population*3;
  return {metadata:{rulesVersion,populationMonth:'2026-08',lowerMaxHp,basicBaseHp,basicMaxHp,metroBaseHp},regions:rows,aliases:rows.some(r=>r.tier==='alias')?{'3611000000':'3600000000'}:{}};
}

export function setup(t:TestContext) {
  const directory = mkdtempSync(join(tmpdir(),'walkwar-core-'));
  const data = join(directory,'data'); mkdirSync(data);
  writeFileSync(join(data,'regions.json'),JSON.stringify(fixtureCatalogue));
  writeFileSync(join(data,'boundaries.geojson'),JSON.stringify(fixtureBoundaries));
  writeFileSync(join(data,'population-balance.json'),JSON.stringify(fixtureBalance(fixtureCatalogue.regions)));
  const db = join(directory,'game.sqlite');
  const regions = new RegionService(data);
  let game = new GameService(new GameStore(db),regions);
  let now = Date.now(), request = 0, seq = 0;
  t.mock.method(Date,'now',()=>now);
  t.after(()=>{game.close();rmSync(directory,{recursive:true,force:true});});
  const user = game.join({clientId:'test-client',displayName:'테스트 여행자'});
  const id = user.player.id;
  return {
    get game(){return game}, regions, id, db, data,
    now:()=>now,
    advance:(ms=250)=>{now+=ms;},
    request:()=> 'request-'+(++request),
    state:()=>game.state(id),
    start:(mode:'virtual'|'gps',regionId?:string)=>{
      seq=0;
      if(mode==='gps'&&regionId){
        // Match the app flow: browse -> verified local fix -> explicit target.
        // Entering the target creates a fresh session and sensor baseline.
        const target=regions.get(regionId).region;
        const local=target.level==='emd'?target:regions.regions.find(r=>
          r.level==='emd'&&regions.ancestors(r).some(parent=>parent.id===regionId));
        if(!local?.center)throw new Error('Fixture target has no known interior GPS point');
        const browsing=game.session(id,{requestId:'session-'+(++request),mode:'gps'});
        game.gps(id,{sessionId:browsing.sessionId,seq:1,
          lat:local.center.lat,lon:local.center.lon,accuracyM:8,capturedAt:now,
          stepCounter:0,sensorEpoch:'fixture-verification'});
      }
      return game.session(id,{requestId:'session-'+(++request),mode,...(regionId?{regionId}:{})});
    },
    move:(axisX=1,axisY=0)=>{
      const state=game.state(id);
      game.input(id,{sessionId:state.sessionId,seq:++seq,axisX,axisY});
    },
    tick:(count=1)=>{
      for(let i=0;i<count;i++){now+=250;game.tick();}
    },
    victory:()=>{
      const initial=game.state(id).progress.wins;
      for(let i=0;i<2000;i++){
        const state=game.state(id);
        game.input(id,{sessionId:state.sessionId,seq:++seq,axisX:1,axisY:0});
        game.heartbeat(id,{sessionId:state.sessionId});
        now+=250;game.tick();
        const updated=game.state(id);
        if(updated.progress.wins>initial)return updated;
      }
      throw new Error('No contributed victory after 2,000 active movement ticks');
    },
    gps:(counter:number,options:Record<string,unknown>={})=>{
      now+=5000;
      const region = regions.get(IDS.busan).region;
      return game.gps(id,{sessionId:game.state(id).sessionId,seq:++seq,
        lat:region.center!.lat,lon:region.center!.lon,accuracyM:8,
        capturedAt:now,stepCounter:counter,sensorEpoch:'sensor-one',...options});
    },
    restart:(edit?:(state:any)=>void,updatedRegions=regions)=>{
      game.close();
      if(edit){const store=new GameStore(db);const saved=store.load<any>()!;edit(saved.state);store.save(saved.state,saved.version+1);store.close();}
      game=new GameService(new GameStore(db),updatedRegions);
      return game.join({clientId:'test-client',displayName:'테스트 여행자'});
    }
  };
}

