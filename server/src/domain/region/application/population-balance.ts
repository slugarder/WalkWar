import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Region } from './region-service.js';

export type PopulationTier = 'lower'|'basic'|'metro'|'alias';
type Entry = { code:string; population:number; tier:PopulationTier; eligible:boolean; maxHp:number|null };
type Metadata = { rulesVersion:string; populationMonth:string; lowerMaxHp:number; basicBaseHp:number; basicMaxHp:number; metroBaseHp:number };
type BalanceFile = { metadata:Metadata; regions:Entry[]; aliases:Record<string,string> };
const integer = (value:unknown):value is number => Number.isSafeInteger(value) && Number(value)>=0;

/** A frozen population snapshot, validated once at server startup. Missing data is fatal. */
export class PopulationBalance {
  readonly metadata:Metadata;
  private readonly entries:Map<string,Entry>;
  private readonly aliases:Record<string,string>;
  constructor(dataDir:string, regions:Region[]) {
    const data = JSON.parse(readFileSync(resolve(dataDir,'population-balance.json'),'utf8')) as BalanceFile;
    const fail = (message:string):never => { throw new Error(`Invalid population balance: ${message}`); };
    const md=data?.metadata;
    if(!md || typeof md.rulesVersion!=='string' || !md.rulesVersion || !/^\d{4}-\d{2}$/.test(md.populationMonth) || !['lowerMaxHp','basicBaseHp','basicMaxHp','metroBaseHp'].every(key=>integer(md[key as keyof Metadata])))fail('metadata');
    if(!Array.isArray(data.regions) || !data.aliases || typeof data.aliases!=='object' || Array.isArray(data.aliases))fail('rows/aliases');
    this.metadata=Object.freeze({...md});this.aliases={...data.aliases};this.entries=new Map();
    const catalogue=new Map(regions.map(r=>[r.code,r]));
    if(catalogue.size!==regions.length)fail('duplicate catalogue codes');
    const byId=new Map(regions.map(r=>[r.id,r]));
    for(const row of data.regions){
      const region=catalogue.get(row.code);
      if(!region || this.entries.has(row.code) || !integer(row.population) || !['lower','basic','metro','alias'].includes(row.tier) || typeof row.eligible!=='boolean')fail(`region ${row.code}`);
      const expectedTier=this.aliases[row.code]?'alias':region!.level==='sido'?'metro':region!.level==='emd'||byId.get(region!.parentId??'')?.level==='sigungu'||['5011000000','5013000000'].includes(row.code)?'lower':'basic';
      if(row.tier!==expectedTier)fail(`tier ${row.code}`);
      if(row.tier==='alias'){
        if(row.eligible || row.maxHp!==null || !this.aliases[row.code])fail(`alias ${row.code}`);
      } else {
        const eligible=row.population>0 && region!.boundaryAvailable!==false;
        if(row.eligible!==eligible)fail(`eligibility ${row.code}`);
        const expected=row.tier==='lower'?Math.max(1000,row.population*3):row.tier==='basic'?md.basicBaseHp+row.population*3:md.metroBaseHp+row.population*3;
        if(row.eligible ? !integer(row.maxHp)||row.maxHp!==expected : row.maxHp!==null)fail(`HP ${row.code}`);
      }
      this.entries.set(row.code,Object.freeze({...row}));
    }
    if(this.entries.size!==catalogue.size)fail('missing regions');
    for(const [alias,target] of Object.entries(this.aliases)){
      if(this.entries.get(alias)?.tier!=='alias' || !this.entries.get(target)?.eligible || this.entries.get(target)?.tier==='alias')fail(`alias target ${alias}`);
    }
    const maximum=(tier:PopulationTier)=>Math.max(0,...[...this.entries.values()].filter(row=>row.tier===tier&&row.eligible).map(row=>row.maxHp!));
    if(md.lowerMaxHp!==maximum('lower') || md.basicBaseHp!==Math.max(10000,md.lowerMaxHp*10) || md.basicMaxHp!==maximum('basic') || md.metroBaseHp!==Math.max(100000,md.basicMaxHp*10))fail('tier bounds');
  }
  canonicalCode(code:string){return this.aliases[code]??code;}
  get(code:string){const row=this.entries.get(this.canonicalCode(code));if(!row)throw new Error(`Missing population balance: ${code}`);return row;}
  raw(code:string){return this.entries.get(code)!;}
}
