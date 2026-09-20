import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bad, missing } from '../../../global/error/api-error.js';
import { PopulationBalance, type PopulationTier } from './population-balance.js';

export type Region = { id:string; code:string; codeSystem:string; name:string; fullName:string; level:'sido'|'sigungu'|'emd'; parentId:string|null; center:{lat:number;lon:number}|null; aliases?:string[]; mapSelectable?:boolean; isAggregateCity?:boolean; boundaryAvailable?:boolean; population?:number; populationMonth?:string; hpTier?:PopulationTier; targetAvailable?:boolean; maxHp?:number|null; canonicalRegionId?:string };
type Geometry = { type:'Polygon'|'MultiPolygon'; coordinates:number[][][]|number[][][][] };
type Feature = { type:'Feature'; properties:Record<string, unknown>; geometry:Geometry };
type Catalogue = { metadata?:Record<string, unknown>; regions?:Region[] } | Region[];
const pointInRing = (p:[number,number], ring:number[][]) => { let inside=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++) { const [xi,yi]=ring[i]!,[xj,yj]=ring[j]!; if (((yi>p[1]) !== (yj>p[1])) && p[0] < (xj-xi)*(p[1]-yi)/(yj-yi)+xi) inside=!inside; } return inside; };
const contains = (p:[number,number], g:Geometry) => { const polys = g.type==='Polygon' ? [g.coordinates as number[][][]] : g.coordinates as number[][][][]; return polys.some(poly => pointInRing(p,poly[0]!) && !poly.slice(1).some(hole=>pointInRing(p,hole))); };
const bbox = (g:Geometry) => { const points:number[][]=[]; const visit=(v:unknown):void=>{ if(Array.isArray(v)&&typeof v[0]==='number') points.push(v as number[]); else if(Array.isArray(v)) v.forEach(visit); }; visit(g.coordinates); return points.reduce((b,n)=>[Math.min(b[0],n[0]!),Math.min(b[1],n[1]!),Math.max(b[2],n[0]!),Math.max(b[3],n[1]!)],[Infinity,Infinity,-Infinity,-Infinity]); };
export class RegionService {
  readonly regions:Region[]; readonly balance:PopulationBalance; private byId:Map<string,Region>; private features:Map<string,Feature>; private featureBboxes:Map<string,number[]>; readonly info:{date:string;source:string;regionCount:number;populationMonth:string;hpRulesVersion:string};
  constructor(dataDir=resolve(process.cwd(),'data')) {
    const cataloguePath=resolve(dataDir,'regions.json'), boundaryPath=resolve(dataDir,'boundaries.geojson');
    const raw:Catalogue = existsSync(cataloguePath) ? JSON.parse(readFileSync(cataloguePath,'utf8')) : [];
    this.regions=Array.isArray(raw)?raw:(raw.regions??[]); this.byId=new Map(this.regions.map(r=>[r.id,r]));
    this.balance=new PopulationBalance(dataDir,this.regions);
    const byCode=new Map(this.regions.map(r=>[r.code,r]));
    for(const region of this.regions){
      const entry=this.balance.get(region.code),canonical=byCode.get(this.balance.canonicalCode(region.code))!;
      Object.assign(region,{population:entry.population,populationMonth:this.balance.metadata.populationMonth,hpTier:entry.tier,targetAvailable:entry.eligible,maxHp:entry.maxHp,canonicalRegionId:canonical.id});
    }
    const geo = existsSync(boundaryPath) ? JSON.parse(readFileSync(boundaryPath,'utf8')) as {features?:Feature[]} : {features:[]}; this.features=new Map(); this.featureBboxes=new Map();
    for(const feature of geo.features??[]) { const id=String(feature.properties.regionId??feature.properties.id??feature.properties.code??''); if(id && feature.geometry && (feature.geometry.type==='Polygon'||feature.geometry.type==='MultiPolygon')) { this.features.set(id,feature); const b=feature.properties.bbox; this.featureBboxes.set(id,Array.isArray(b)&&b.length===4?b.map(Number):bbox(feature.geometry)); } }
    for(const region of this.regions)if(!this.features.has(region.canonicalRegionId??region.id))region.targetAvailable=false;
    const md=Array.isArray(raw)?{}:(raw.metadata??{}); this.info={date:String(md.date??md.boundaryDate??'unavailable'),source:String(md.source??md.provenance??'not loaded'),regionCount:this.regions.length,populationMonth:this.balance.metadata.populationMonth,hpRulesVersion:this.balance.metadata.rulesVersion};
  }
  list(query:{parentId?:string;q?:string;level?:string;offset?:number;limit?:number}) {
    if(query.level&&!['sido','sigungu','emd'].includes(query.level)) throw bad('INVALID_INPUT','지원하지 않는 지역 레벨입니다.');
    const normalize=(value:string)=>value.toLowerCase().replace(/\s/g,'').replace(/제(?=\d)/g,'');
    const parent=query.parentId===undefined&&!query.q&&!query.level?null:query.parentId;
    const all=this.regions.filter(r=>(parent===undefined||r.parentId===parent)&&(!query.q||normalize(`${r.name} ${r.fullName} ${(r.aliases??[]).join(' ')}`).includes(normalize(query.q)))&&(!query.level||r.level===query.level));
    const offset=Math.max(0,Math.trunc(Number(query.offset??0))),limit=Math.min(200,Math.max(1,Math.trunc(Number(query.limit??100))));
    if(!Number.isFinite(offset)||!Number.isFinite(limit))throw bad('INVALID_INPUT','목록 범위가 올바르지 않습니다.');
    return {regions:all.slice(offset,offset+limit),total:all.length,offset,dataInfo:this.info};
  }
  get(id:string) { const region=this.byId.get(id); if(!region) throw missing('REGION_NOT_FOUND','지역을 찾을 수 없습니다.'); return {region,ancestors:this.ancestors(region)}; }
  canonical(region:Region){return this.byId.get(region.canonicalRegionId??region.id)!;}
  target(id:string){const region=this.canonical(this.get(id).region);if(!region.targetAvailable)throw bad('REGION_UNAVAILABLE','인구 또는 행정 경계 데이터가 없어 공략할 수 없는 지역입니다.');return region;}
  ancestors(region:Region) { const out:Region[]=[]; let node=region; while(node.parentId) { const parent=this.byId.get(node.parentId); if(!parent) break; out.unshift(parent); node=parent; } return out; }
  contains(regionId:string, lat:number, lon:number) { const f=this.features.get(regionId),b=this.featureBboxes.get(regionId); return !!f&&!!b&&lon>=b[0]!&&lon<=b[2]!&&lat>=b[1]!&&lat<=b[3]!&&contains([lon,lat],f.geometry); }
  containsResolvedTarget(regionId:string, located:Region|null, lat:number, lon:number) { return !!located && (located.id===regionId || this.ancestors(located).some(x=>x.id===regionId) || this.contains(regionId,lat,lon)); }
  at(lat:number,lon:number,level?:string) { if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180) throw bad('INVALID_INPUT','좌표가 필요합니다.'); if(level&&!['sido','sigungu','emd'].includes(level)) throw bad('INVALID_INPUT','지원하지 않는 지역 레벨입니다.'); const emd=this.regions.find(r=>r.level==='emd'&&this.contains(r.id,lat,lon))??null; let candidate:Region|null=emd; if(level&&emd){ candidate=level==='emd'?emd:this.ancestors(emd).filter(x=>x.level===level&&(x as Region&{mapSelectable?:boolean}).mapSelectable!==false).at(-1)??null; } return {region:candidate,ancestors:emd?this.ancestors(emd):[]}; }
  map(level:string, west:number,south:number,east:number,north:number,limit:number,overview=false) {
    if(!['sido','sigungu','emd'].includes(level)||![west,south,east,north,limit].every(Number.isFinite)||west>east||south>north||west<-180||east>180||south<-90||north>90)throw bad('INVALID_INPUT','지도 범위와 레벨이 필요합니다.');
    const cap=Math.min(200,Math.max(1,Math.trunc(limit)));
    const rows=this.regions.filter(r=>r.level===level&&(overview&&level==='sigungu'?(!r.parentId||this.byId.get(r.parentId)?.level==='sido'):r.mapSelectable!==false)).flatMap(region=>{
      const f=this.features.get(region.id),b=this.featureBboxes.get(region.id);if(!f||!b)return[];
      return b[2]!<west||b[0]!>east||b[3]!<south||b[1]!>north?[]:[{region,geometry:f.geometry}];
    });
    return {features:rows.slice(0,cap),truncated:rows.length>cap,dataInfo:this.info};
  }
}
