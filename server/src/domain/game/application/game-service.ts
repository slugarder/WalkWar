import { bad, conflict, missing } from '../../../global/error/api-error.js';
import { RegionService, type Region } from '../../region/application/region-service.js';
import { GameStore } from '../dao/game-store.js';

type Mode='virtual'|'gps';
type Progress={points:number;badges:any[];ownedItems:string[];earnedTitles:string[];equipment:Record<string,string|null>;wins:number;distinct:string[];localWins:Record<string,number>};
type Fix={lat:number;lon:number;counter:number;epoch:string;emdId:string|null;at:number;receivedAt:number;valid:boolean;credit?:number};
type Session={id:string;regionId:string|null;lastSeq:number;seen:number;input?:{x:number;y:number;at:number};gps?:Fix};
type PlayerState={steps:number;fraction:number;x:number;y:number;lat:number|null;lon:number|null;gpsStatus:string;session:Session|null;progress:Progress};
type Player={id:string;clientId:string;name:string;states:Record<Mode,PlayerState>};
type Raid={number:number;hp:number;maxHp:number;hpRulesVersion:string;status:'running'|'paused';latest:any|null;contrib:Record<string,number>;npcFraction:Record<string,number>};
type State={players:Record<string,Player>;raids:Record<string,Raid>;history:any[];retiredAliasRaids?:Record<string,Raid>};
const MODES:Mode[]=['virtual','gps'];
const LEGACY_MAX_HP=720;
const SHOP=[
  {id:'cafe-postcard',name:'전포 네온 프레임',description:'프로필에 민트빛 테두리를 더해요.',price:30,slot:'frame',color:'#80C9BE'},
  {id:'wave-pin',name:'파도 프로필 배지',description:'프로필에 파도 탐험가 배지를 표시해요.',price:60,slot:'badge',color:'#7FB5F4'},
  {id:'bujeon-pass',name:'부전 탐험가 이름표',description:'탐험가의 이름을 금빛으로 표시해요.',price:100,slot:'nameplate',color:'#E5BE70'}
];
const TITLES=[
  {id:'first-expedition',name:'첫 원정',description:'첫 공략 성공에 기여하기',required:1},
  {id:'local-guardian',name:'지역 수호자',description:'한 지역에서 공략 성공에 3회 기여하기',required:3},
  {id:'national-explorer',name:'전국 탐험가',description:'서로 다른 읍·면·동 5곳의 공략 성공에 기여하기',required:5}
];
const NPCS=[
  {id:'npc-hana',name:'하나',teamId:'travelers',teamName:'대한민국 탐험대',country:'KR',speed:1},
  {id:'npc-duri',name:'두리',teamId:'travelers',teamName:'대한민국 탐험대',country:'KR',speed:.8},
  {id:'npc-jamie',name:'Jamie',teamId:'team-us',teamName:'미국 탐험대',country:'US',speed:1.3},
  {id:'npc-alex',name:'Alex',teamId:'team-us',teamName:'미국 탐험대',country:'US',speed:.9},
  {id:'npc-haru',name:'Haru',teamId:'team-jp',teamName:'일본 탐험대',country:'JP',speed:1.1},
  {id:'npc-yuki',name:'Yuki',teamId:'team-jp',teamName:'일본 탐험대',country:'JP',speed:.7}
];
const initial=():PlayerState=>({steps:0,fraction:0,x:60,y:40,lat:null,lon:null,gpsStatus:'현재 위치 확인 중',session:null,
  progress:{points:0,badges:[],ownedItems:[],earnedTitles:[],equipment:{frame:null,badge:null,nameplate:null,title:null},wins:0,distinct:[],localWins:{}}});
function ranks(rows:any[]){
  const sorted=rows.sort((a,b)=>b.steps-a.steps||a.id.localeCompare(b.id));let rank=0;
  return sorted.map((row,index)=>{if(index===0||row.steps!==sorted[index-1].steps)rank=index+1;return{...row,rank};});
}
const asFlag=(country:string)=>country.toUpperCase().split('').map(c=>String.fromCodePoint(0x1f1e6+c.charCodeAt(0)-65)).join('');

export class GameService {
  private s:State;private version:number;private lastTick=Date.now();
  constructor(private db:GameStore,private regions:RegionService){
    const stored=db.load<State>();this.s=stored?.state??{players:{},raids:{},history:[]};this.version=stored?.version??0;
    this.s.history??=Object.values(this.s.raids).flatMap(r=>r.latest?[r.latest]:[]);
    let migrated=false;
    for(const [key,raid] of Object.entries(this.s.raids)){
      raid.status??='running';raid.npcFraction??={};
      const region=this.regions.regions.find(r=>r.id===key.slice(key.indexOf(':')+1));
      if(!region?.targetAvailable)continue;
      if(raid.maxHp===undefined){
        if(!Number.isSafeInteger(raid.hp)||raid.hp<0||raid.hp>LEGACY_MAX_HP)throw new Error(`Invalid legacy raid HP: ${key}`);
        const damage=LEGACY_MAX_HP-raid.hp;
        raid.maxHp=region.maxHp!;raid.hp=raid.maxHp-damage;raid.hpRulesVersion=this.regions.balance.metadata.rulesVersion;migrated=true;
      } else if(!Number.isSafeInteger(raid.maxHp)||raid.maxHp<1||!Number.isSafeInteger(raid.hp)||raid.hp<0||raid.hp>raid.maxHp||!raid.hpRulesVersion){
        throw new Error(`Invalid persisted raid HP: ${key}`);
      }
    }
    // Sejong's statistical middle row is the same target as the province.
    // Archive duplicate live rows, preserve their damage/contributions and all history.
    for(const [key,aliasRaid] of Object.entries(this.s.raids)){
      const region=this.regions.regions.find(r=>r.id===key.slice(key.indexOf(':')+1));
      if(!region?.targetAvailable || region.canonicalRegionId===region.id)continue;
      const canonicalKey=`${key.slice(0,key.indexOf(':'))}:${region.canonicalRegionId}`,existing=this.s.raids[canonicalKey];
      this.s.retiredAliasRaids??={};this.s.retiredAliasRaids[key]=structuredClone(aliasRaid);
      if(!existing)this.s.raids[canonicalKey]=aliasRaid;
      else{
        const damage=aliasRaid.maxHp-aliasRaid.hp;
        existing.hp=Math.max(0,existing.hp-damage);
        for(const [id,steps] of Object.entries(aliasRaid.contrib))existing.contrib[id]=(existing.contrib[id]??0)+steps;
        for(const [id,fraction] of Object.entries(aliasRaid.npcFraction))existing.npcFraction[id]=(existing.npcFraction[id]??0)+fraction;
        existing.number=Math.max(existing.number,aliasRaid.number);
        if(aliasRaid.status==='paused')existing.status='paused';
        if(aliasRaid.latest&&(!existing.latest||aliasRaid.latest.defeatedAt>existing.latest.defeatedAt))existing.latest=aliasRaid.latest;
      }
      delete this.s.raids[key];migrated=true;
    }
    for(const p of Object.values(this.s.players))for(const mode of MODES){
      const st=p.states[mode];st.fraction??=0;st.progress.localWins??={};
      if(st.session){
        if(st.session.regionId){const region=this.regions.regions.find(r=>r.id===st.session!.regionId),canonical=region?.targetAvailable?region.canonicalRegionId??region.id:null;if(canonical!==st.session.regionId){st.session.regionId=canonical;migrated=true;}}
        st.session.input=undefined;st.session.gps=undefined;st.session.seen=0;st.session.lastSeq??=0;
      }
    }
    if(migrated){this.db.backupMigration('population-hp-v1');this.save();}
  }
  private save(receipt?:{player:string;id:string;json:unknown}){
    try{this.db.save(this.s,this.version+1,receipt);this.version++;}
    catch(error){const saved=this.db.load<State>();if(saved){this.s=saved.state;this.version=saved.version;}throw error;}
  }
  private player(id:string){const p=this.s.players[id];if(!p)throw missing('PLAYER_NOT_FOUND','플레이어를 찾을 수 없습니다. 다시 연결해 주세요.');return p;}
  private current(p:Player,id:string){
    for(const mode of MODES){const state=p.states[mode];if(state.session?.id===id)return{mode,state,session:state.session};}
    throw conflict('STALE_SESSION','세션이 만료되었습니다. 모드를 다시 선택해 주세요.');
  }
  private raid(mode:Mode,region:Region){region=this.regions.target(region.id);return this.s.raids[`${mode}:${region.id}`]??={number:1,hp:region.maxHp!,maxHp:region.maxHp!,hpRulesVersion:this.regions.balance.metadata.rulesVersion,status:'running',latest:null,contrib:{},npcFraction:{}};}
  private respawn(raid:Raid,region:Region){raid.maxHp=this.regions.target(region.id).maxHp!;raid.hp=raid.maxHp;raid.hpRulesVersion=this.regions.balance.metadata.rulesVersion;raid.contrib={};raid.npcFraction={};}
  private replay(player:Player,requestId:unknown,logical:unknown){
    if(typeof requestId!=='string'||!requestId||requestId.length>200)throw bad('INVALID_INPUT','요청 ID가 필요합니다.');
    const old=this.db.receipt(player.id,requestId);
    const canonicalReceipt=(value:any)=>value?.operation==='session'&&value.regionId?{...value,regionId:this.regions.regions.find(r=>r.id===value.regionId)?.canonicalRegionId??value.regionId}:value;
    if(old&&JSON.stringify(canonicalReceipt(old))!==JSON.stringify(canonicalReceipt(logical)))throw conflict('REQUEST_CONFLICT','다른 작업에 사용된 요청 ID입니다.');return !!old;
  }
  private badge(progress:Progress,id:string,name:string){if(!progress.badges.some(b=>b.id===id))progress.badges.push({id,name,earnedAt:new Date().toISOString()});}
  private identity(id:string,mode:Mode){
    const npc=NPCS.find(n=>n.id===id);if(npc)return{...npc,simulated:true,title:null,frame:null};
    const p=this.player(id),equipment=p.states[mode].progress.equipment;
    return{id:p.id,name:p.name,teamId:'travelers',teamName:'대한민국 탐험대',country:'KR',simulated:false,title:TITLES.find(t=>t.id===equipment.title)?.name??null,frame:equipment.frame};
  }
  private ranking(raid:Raid,mode:Mode){
    const personal=ranks(Object.entries(raid.contrib).filter(([,steps])=>steps>0).map(([id,steps])=>({...this.identity(id,mode),steps})));
    const groups=new Map<string,any>();
    for(const person of personal){
      const team=groups.get(person.teamId)??{id:person.teamId,name:person.teamName,teamId:person.teamId,teamName:person.teamName,country:person.country,steps:0,simulated:true,title:null,frame:null};
      team.steps+=person.steps;team.simulated&&=person.simulated;groups.set(team.id,team);
    }
    return{personal,teams:ranks([...groups.values()])};
  }
  capture(mode:Mode,region:Region){
    region=this.regions.canonical(region);
    const defeat=this.s.raids[`${mode}:${region.id}`]?.latest;
    return defeat?{defeatedAt:defeat.defeatedAt,encounterNumber:defeat.encounterNumber,teams:defeat.teams.filter((t:any)=>t.rank===1).map((t:any)=>({id:t.id,name:t.name,country:t.country,rank:1,flag:t.country?asFlag(t.country):'🏳️'}))}:null;
  }
  join(input:any){
    if(typeof input?.clientId!=='string'||!input.clientId.trim()||input.clientId.length>200)throw bad('INVALID_INPUT','클라이언트 ID가 필요합니다.');
    const name=typeof input.displayName==='string'?input.displayName.trim().slice(0,20):'';if(!name)throw bad('INVALID_INPUT','이름을 입력해 주세요.');
    let p=Object.values(this.s.players).find(p=>p.clientId===input.clientId);
    if(!p){p={id:`player-${crypto.randomUUID()}`,clientId:input.clientId,name,states:{virtual:initial(),gps:initial()}};this.s.players[p.id]=p;}
    p.name=name;for(const mode of MODES)p.states[mode].session=null;this.save();return this.snap(p,'virtual');
  }
  state(id:string){return this.snap(this.player(id));}
  session(id:string,input:any){
    const p=this.player(id);if(!MODES.includes(input?.mode))throw bad('INVALID_INPUT','GPS 또는 가상 모드를 선택해 주세요.');
    const mode=input.mode as Mode,region=input.regionId?this.regions.target(input.regionId):null;
    const logical={operation:'session',mode,regionId:region?.id??null};
    if(this.replay(p,input.requestId,logical)){
      if(p.states[mode].session?.regionId!==(region?.id??null))throw conflict('STALE_SESSION','이전 지역 선택 요청입니다.');return this.snap(p,mode);
    }
    if(mode==='gps'&&region){
      const fix=p.states.gps.session?.gps;
      if(!fix?.valid||Date.now()-fix.at>30000)throw conflict('GPS_NOT_READY','정확한 현재 위치를 확인한 뒤 공략을 시작해 주세요.');
      const emd=fix.emdId?this.regions.get(fix.emdId).region:null;
      if(!this.regions.containsResolvedTarget(region.id,emd,fix.lat,fix.lon))throw conflict('GPS_OUTSIDE_REGION','현재 위치가 선택한 지역 밖입니다.');
    }
    for(const m of MODES)p.states[m].session=null;
    const st=p.states[mode];st.fraction=0;st.x=60;st.y=40;st.session={id:crypto.randomUUID(),regionId:region?.id??null,lastSeq:0,seen:Date.now()};
    if(region)this.raid(mode,region);this.save({player:id,id:input.requestId,json:logical});return this.snap(p,mode);
  }
  input(id:string,input:any){
    const c=this.current(this.player(id),input?.sessionId);if(c.mode!=='virtual')throw conflict('WRONG_MODE','가상 이동은 가상 모드에서만 사용할 수 있습니다.');
    if(!Number.isSafeInteger(input.seq)||input.seq<1||!Number.isFinite(input.axisX)||!Number.isFinite(input.axisY))throw bad('INVALID_INPUT','이동 입력이 올바르지 않습니다.');
    if(input.seq<=c.session.lastSeq)return{accepted:false,lastSeq:c.session.lastSeq};
    let x=Math.max(-1,Math.min(1,input.axisX)),y=Math.max(-1,Math.min(1,input.axisY));const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
    c.session.lastSeq=input.seq;c.session.seen=Date.now();c.session.input={x,y,at:Date.now()};return{accepted:true,lastSeq:input.seq};
  }
  heartbeat(id:string,input:any){this.current(this.player(id),input?.sessionId).session.seen=Date.now();return{ok:true};}
  gps(id:string,input:any){
    const p=this.player(id),c=this.current(p,input?.sessionId);if(c.mode!=='gps')throw conflict('WRONG_MODE','현재 GPS 모드가 아닙니다.');
    if(!Number.isSafeInteger(input.seq)||input.seq<1||![input.lat,input.lon,input.accuracyM,input.capturedAt,input.stepCounter].every(Number.isFinite)||Math.abs(input.lat)>90||Math.abs(input.lon)>180||input.accuracyM<0||!Number.isSafeInteger(input.stepCounter)||input.stepCounter<0||typeof input.sensorEpoch!=='string'||!input.sensorEpoch)throw bad('INVALID_INPUT','GPS 측정값이 올바르지 않습니다.');
    if(input.seq<=c.session.lastSeq)return this.snap(p,'gps');
    const now=Date.now(),prior=c.session.gps,accurate=input.accuracyM<=50&&now-input.capturedAt<=30000&&input.capturedAt<=now+5000;
    const emd=accurate?this.regions.at(input.lat,input.lon,'emd').region:null,valid=accurate&&!!emd;
    c.session.lastSeq=input.seq;c.session.seen=now;
    if(valid){c.state.lat=input.lat;c.state.lon=input.lon;}
    const region=c.session.regionId?this.regions.get(c.session.regionId).region:null,inside=region&&emd&&this.regions.containsResolvedTarget(region.id,emd,input.lat,input.lon);
    const delta=input.stepCounter-(prior?.counter??input.stepCounter),elapsed=prior?Math.max(0,(now-prior.receivedAt)/1000):0;
    const continuous=valid&&inside&&prior?.valid&&prior.epoch===input.sensorEpoch&&prior.emdId===emd?.id&&delta>=0&&now-prior.receivedAt<=30000&&now-prior.at<=30000;
    let credit=valid&&inside?4:0,accepted=false;
    if(continuous){
      credit=Math.min(120,(prior.credit??0)+elapsed*4);
      const raid=this.raid('gps',region!);
      if(delta>0&&delta<=credit&&raid.status==='running'){
        this.contribute(p.id,'gps',region!,delta,true);credit=Math.max(0,credit-delta);accepted=true;
      } else if(delta>0) credit=0;
    }
    c.session.gps={lat:input.lat,lon:input.lon,counter:input.stepCounter,epoch:input.sensorEpoch,emdId:emd?.id??null,at:input.capturedAt,receivedAt:now,valid,credit};
    c.state.gpsStatus=!accurate?'GPS 정확도·측정 시간을 확인해 주세요':!emd?'행정 경계 밖이거나 경계 데이터가 없는 위치예요':!region?'국기를 눌러 공략할 지역을 선택해 주세요':!inside?'선택한 공략 지역 밖이에요':this.raid('gps',region).status==='paused'?'공략이 일시정지되어 걸음을 반영하지 않아요':accepted?'걸음을 공략에 반영했어요':delta>0?'걸음 기준을 갱신했어요. 다음 걸음부터 반영됩니다.':'공략 가능한 위치예요. 걸음 입력을 기다리고 있어요';
    this.save();return this.snap(p,'gps');
  }
  private contribute(id:string,mode:Mode,region:Region,steps:number,human:boolean){
    if(steps<=0)return;const raid=this.raid(mode,region);if(raid.status!=='running')return;
    const damage=Math.min(raid.hp,steps);raid.contrib[id]=(raid.contrib[id]??0)+damage;raid.hp-=damage;
    if(human){const state=this.player(id).states[mode];state.steps+=steps;this.badge(state.progress,'first-step','첫 걸음');}
    if(raid.hp>0)return;
    const {personal,teams}=this.ranking(raid,mode),defeat={id:crypto.randomUUID(),regionId:region.id,regionName:region.fullName,regionLevel:region.level,mode,encounterNumber:raid.number,maxHp:raid.maxHp,hpRulesVersion:raid.hpRulesVersion,defeatedAt:new Date().toISOString(),personal,teams};
    for(const row of personal.filter(p=>!p.simulated)){
      const progress=this.player(row.id).states[mode].progress;progress.points+=100;progress.wins++;progress.localWins[region.id]=(progress.localWins[region.id]??0)+1;
      if(region.level==='emd'&&!progress.distinct.includes(region.id))progress.distinct.push(region.id);
      const unlocked=['first-expedition',...(progress.localWins[region.id]>=3?['local-guardian']:[]),...(progress.distinct.length>=5?['national-explorer']:[])];
      for(const title of unlocked)if(!progress.earnedTitles.includes(title))progress.earnedTitles.push(title);this.badge(progress,'first-victory','첫 공략 성공');
    }
    raid.latest=defeat;this.s.history.push(defeat);raid.number++;this.respawn(raid,region);
  }
  tick(){
    const now=Date.now(),dt=Math.min(1,Math.max(0,(now-this.lastTick)/1000));this.lastTick=now;if(!dt)return;
    const active=new Map<string,{mode:Mode;region:Region}>();let changed=false;
    for(const p of Object.values(this.s.players))for(const mode of MODES){
      const state=p.states[mode],session=state.session;if(!session?.regionId||now-session.seen>3000)continue;
      const region=this.regions.get(session.regionId).region,raid=this.raid(mode,region);if(raid.status!=='running')continue;
      active.set(`${mode}:${region.id}`,{mode,region});if(mode!=='virtual'||!session.input||now-session.input.at>750)continue;
      const {x,y}=session.input,distance=Math.hypot(x,y)*6*dt;if(!distance)continue;
      state.x=(state.x+x*6*dt+120)%120;state.y=(state.y+y*6*dt+80)%80;state.fraction+=distance/.75;const steps=Math.floor(state.fraction);state.fraction-=steps;
      this.contribute(p.id,mode,region,steps,true);changed=true;
    }
    for(const {mode,region} of active.values())for(const npc of NPCS){
      const raid=this.raid(mode,region);raid.npcFraction[npc.id]=(raid.npcFraction[npc.id]??0)+npc.speed*dt;
      const steps=Math.floor(raid.npcFraction[npc.id]);raid.npcFraction[npc.id]-=steps;this.contribute(npc.id,mode,region,steps,false);changed=true;
    }
    if(changed)this.save();
  }
  control(id:string,input:any){
    const p=this.player(id),c=this.current(p,input?.sessionId);if(!['pause','resume','reset'].includes(input.action))throw bad('INVALID_INPUT','지원하지 않는 제어입니다.');
    if(!c.session.regionId)throw conflict('NO_TARGET','먼저 공략할 지역을 선택해 주세요.');
    const logical={operation:'control',mode:c.mode,sessionId:c.session.id,action:input.action};if(this.replay(p,input.requestId,logical))return this.snap(p,c.mode);
    const raid=this.raid(c.mode,this.regions.get(c.session.regionId).region);
    if(input.action==='reset'){this.respawn(raid,this.regions.get(c.session.regionId).region);}else raid.status=input.action==='pause'?'paused':'running';
    for(const other of Object.values(this.s.players)){const s=other.states[c.mode].session;if(s?.regionId===c.session.regionId){s.input=undefined;s.gps=undefined;other.states[c.mode].fraction=0;}}
    this.save({player:id,id:input.requestId,json:logical});return this.snap(p,c.mode);
  }
  purchase(id:string,input:any){
    const p=this.player(id),c=this.current(p,input?.sessionId),logical={operation:'purchase',mode:c.mode,sessionId:c.session.id,itemId:input.itemId};
    if(this.replay(p,input.requestId,logical))return this.snap(p,c.mode);const item=SHOP.find(i=>i.id===input.itemId),progress=c.state.progress;
    if(!item)throw bad('INVALID_ITEM','상품을 찾을 수 없습니다.');if(progress.ownedItems.includes(item.id))throw conflict('ITEM_ALREADY_OWNED','이미 보유한 상품입니다.');
    if(progress.points<item.price)throw conflict('INSUFFICIENT_POINTS','포인트가 부족합니다.');progress.points-=item.price;progress.ownedItems.push(item.id);
    this.save({player:id,id:input.requestId,json:logical});return this.snap(p,c.mode);
  }
  equipment(id:string,input:any){
    const p=this.player(id),c=this.current(p,input?.sessionId),logical={operation:'equipment',mode:c.mode,sessionId:c.session.id,slot:input.slot,itemId:input.itemId??null};
    if(!['frame','badge','nameplate','title'].includes(input.slot))throw bad('INVALID_SLOT','장착 위치를 확인해 주세요.');if(this.replay(p,input.requestId,logical))return this.snap(p,c.mode);
    if(input.itemId!=null){const owned=input.slot==='title'?c.state.progress.earnedTitles:c.state.progress.ownedItems;if(!owned.includes(input.itemId))throw conflict('NOT_OWNED','보유하지 않은 항목입니다.');if(input.slot!=='title'&&SHOP.find(i=>i.id===input.itemId)?.slot!==input.slot)throw conflict('WRONG_SLOT','이 위치에 장착할 수 없는 상품입니다.');}
    c.state.progress.equipment[input.slot]=input.itemId??null;this.save({player:id,id:input.requestId,json:logical});return this.snap(p,c.mode);
  }
  private personalized(defeat:any,playerId:string){return defeat?{...defeat,myContribution:defeat.personal.find((r:any)=>r.id===playerId)?.steps??0}:null;}
  history(id:string,query:any={}){
    const canonical=(id:string)=>this.regions.regions.find(r=>r.id===id)?.canonicalRegionId??id;
    const p=this.player(id),mode=MODES.find(m=>p.states[m].session)??'virtual',records=this.s.history.filter(d=>d.mode===mode&&(!query.regionId||canonical(d.regionId)===canonical(query.regionId))).slice().reverse();
    const offset=Math.max(0,Math.trunc(Number(query.offset)||0)),limit=Math.min(100,Math.max(1,Math.trunc(Number(query.limit)||30)));
    return structuredClone({records:records.slice(offset,offset+limit).map(d=>this.personalized(d,id)),total:records.length,offset});
  }
  snap(p:Player,mode?:Mode):any{
    mode??=MODES.find(m=>p.states[m].session)??'virtual';const st=p.states[mode],session=st.session,region=session?.regionId?this.regions.get(session.regionId).region:null,raid=region?this.raid(mode,region):null;
    const ranking=raid?this.ranking(raid,mode):{personal:[],teams:[]},participants:any[]=[];
    if(region){
      for(const other of Object.values(this.s.players)){const os=other.states[mode];if(os.session?.regionId!==region.id||(other.id!==p.id&&Date.now()-os.session.seen>3000))continue;participants.push({...this.identity(other.id,mode),xM:os.x,yM:os.y,lat:os.lat,lon:os.lon,steps:os.steps});}
      NPCS.forEach((npc,index)=>participants.push({...this.identity(npc.id,mode),xM:20+index*15,yM:20+(index%3)*20,lat:null,lon:null,steps:raid?.contrib[npc.id]??0}));
    }
    return structuredClone({player:{id:p.id,name:p.name,mode,totalSteps:st.steps,regionId:region?.id??null,xM:st.x,yM:st.y,lat:st.lat,lon:st.lon},sessionId:session?.id??'',worldVersion:this.version,serverTime:new Date().toISOString(),region:region?{...region,capture:this.capture(mode,region)}:null,regionPath:region?this.regions.ancestors(region):[],
      raid:raid?{encounterId:`${mode}:${region!.id}:${raid.number}`,number:raid.number,bossName:`${region!.name} 걷기 괴물`,hp:raid.hp,maxHp:raid.maxHp,hpRulesVersion:raid.hpRulesVersion,status:raid.status,selfContribution:raid.contrib[p.id]??0,currentPersonal:ranking.personal,currentTeams:ranking.teams,latestDefeat:this.personalized(raid.latest,p.id)}:null,
      participants,progress:{...st.progress,distinctRegions:st.progress.distinct.length},catalog:{items:SHOP,titles:TITLES},history:this.s.history.filter(d=>d.mode===mode).slice(-30).reverse().map(d=>this.personalized(d,p.id)),gpsStatus:mode==='gps'?st.gpsStatus:null,dataInfo:this.regions.info});
  }
  close(){this.db.close();}
}
