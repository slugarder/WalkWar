export type PlayMode = 'virtual' | 'gps';
export type RegionLevel = 'sido' | 'sigungu' | 'emd';
export interface Capture { defeatedAt:string; encounterNumber:number; teams:Array<{id:string;name:string;country:string|null;rank:1;flag:string}> }
export interface Region { id:string; code:string; codeSystem:string; name:string; fullName:string; level:RegionLevel; parentId:string|null; center:{lat:number;lon:number}|null; description?:string; capture?:Capture|null; isAggregateCity?:boolean; boundaryAvailable?:boolean; mapSelectable?:boolean; population?:number; populationMonth?:string; hpTier?:"lower"|"basic"|"metro"; targetAvailable?:boolean; maxHp?:number|null; canonicalRegionId?:string }
export type Slot = 'frame'|'badge'|'nameplate'|'title';
export type Equipment = Record<Slot,string|null>;
export interface Item { id:string; name:string; description:string; price:number; slot:Exclude<Slot,'title'>; color:string }
export interface Title { id:string; name:string; description:string; required:number }
export interface Badge { id:string; name:string; earnedAt:string }
export interface Progress { points:number; badges:Badge[]; ownedItems:string[]; earnedTitles:string[]; equipment:Equipment; wins:number; distinctRegions:number }
export interface Ranking { id:string; name:string; teamId:string; teamName:string; rank:number; steps:number; simulated:boolean; country:string|null; title:string|null; frame:string|null }
export interface Defeat { id:string; regionId:string; regionName:string; regionLevel:RegionLevel; mode:PlayMode; encounterNumber:number; defeatedAt:string; personal:Ranking[]; teams:Ranking[]; myContribution:number }
export interface Raid { encounterId:string; number:number; bossName:string; hp:number; maxHp:number; hpRulesVersion?:string; status:'running'|'paused'; selfContribution:number; currentPersonal:Ranking[]; currentTeams:Ranking[]; latestDefeat:Defeat|null }
export interface Participant { id:string; name:string; xM:number; yM:number; lat:number|null; lon:number|null; steps:number; simulated:boolean; teamId:string; title:string|null; frame:string|null }
export interface Snapshot { player:{id:string;name:string;mode:PlayMode;totalSteps:number;regionId:string|null;xM:number;yM:number;lat:number|null;lon:number|null}; sessionId:string; worldVersion:number; serverTime:string; region:Region|null; regionPath:Region[]; raid:Raid|null; participants:Participant[]; progress:Progress; catalog:{items:Item[];titles:Title[]}; history:Defeat[]; gpsStatus:string|null; dataInfo:{date:string;source:string;regionCount:number;populationMonth?:string;hpRulesVersion?:string} }
export interface JoinRequest { clientId:string; displayName:string }
export interface SessionRequest { requestId:string; mode:PlayMode; regionId?:string }
export interface InputRequest { sessionId:string; seq:number; axisX:number; axisY:number }
export interface GpsRequest { sessionId:string; seq:number; lat:number;lon:number;accuracyM:number;capturedAt:number;stepCounter:number;sensorEpoch:string }
export interface RegionsResponse { regions:Region[]; total:number; offset:number; dataInfo:{date:string;source:string;regionCount:number;populationMonth?:string;hpRulesVersion?:string} }
export interface ApiFailure { error:{code:string;message:string;retryable:boolean} }
