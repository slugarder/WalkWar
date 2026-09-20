import React, {useEffect,useState} from 'react';
import {ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View} from 'react-native';
import {GlassPanel} from './GlassPanel';
import {NeonFrame} from './NeonFrame';
import {DiagnosticsPanel} from './DiagnosticsPanel';
import {ActionButton, Icon, Label} from './UI';
import {palette} from '../theme';
import {usePreferences} from '../state/preferences';
import type {useGame} from '../game/useGame';
import type {Defeat, Item, PlayMode, Ranking, Region, RegionsResponse} from '../game/types';
import {derivePersonalRecord,type PersonalRankingInput} from '../game/ranking';

type Game=ReturnType<typeof useGame>;
const number=(n:number)=>n.toLocaleString('ko-KR');
export function flags(region:Region){return region.capture?.teams.map(t=>t.flag).filter(Boolean).join(' ')||'🏳️';}
export function dateLabel(value:string){return new Date(value).toLocaleString('ko-KR');}
export function ConnectScreen({game}:{game:Game}){
  const [name,setName]=useState(game.name);
  useEffect(()=>{setName(game.name);},[game.ready]);
  const start=(mode:PlayMode)=>void game.connect(name.trim(),mode);
  return <View style={{gap:20}}>
    <View style={{gap:6}}><Label size={32} style={{fontWeight:'600'}}>WalkWar</Label><Label muted>어디서 탐험할까요?</Label></View>
    <TextInput accessibilityLabel="참가 이름" testID="player-name" value={name} onChangeText={setName} maxLength={20}
      placeholder="참가 이름" placeholderTextColor={palette.muted} style={p.input} autoCorrect={false} returnKeyType="done"/>
    {(['gps','virtual'] as PlayMode[]).map(mode=>{const record=game.savedRecords[mode];return record?<GlassPanel key={mode} style={{padding:14,gap:6}}>
      <Label size={14}>{mode==='gps'?'GPS':'가상'} · {record.name}의 저장 기록{game.lastMode===mode?' · 최근 플레이':''}</Label>
      <Label size={13}>{number(record.totalSteps)}걸음 · {number(record.progress.points)} P · 공략 성공 {number(record.progress.wins)}회</Label>
      {record.region&&<Label size={12} muted>{record.region.fullName} · 마지막 확인 기여 {number(record.contribution)}</Label>}
    </GlassPanel>:null;})}
    <View style={{gap:4}}><ActionButton label="GPS로 시작" disabled={!game.ready||!name.trim()||game.busy} onPress={()=>start('gps')}/>
      <ActionButton label="가상 이동으로 시작" secondary disabled={!game.ready||!name.trim()||game.busy} onPress={()=>start('virtual')}/></View>
    {game.busy&&<ActivityIndicator color={palette.teal}/>}
    {game.error&&<Label accessibilityRole="alert" size={13}>{game.error}</Label>}
    {game.storageError&&<Label accessibilityRole="alert" size={13}>{game.storageError}</Label>}
    <DiagnosticsPanel/>
  </View>;
}

export function RegionList({game,onInspect,onOverview}:{game:Game;onInspect:(r:Region)=>void;onOverview:()=>void}){
  const [query,setQuery]=useState(''),[rows,setRows]=useState<Region[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let alive=true;const timer=setTimeout(()=>{setLoading(true);setError('');void game.read<RegionsResponse>(`/regions?limit=80${query.trim()?`&q=${encodeURIComponent(query.trim())}`:''}`)
    .then(r=>{if(alive)setRows(r.regions);}).catch(e=>{if(alive)setError(String(e.message));}).finally(()=>{if(alive)setLoading(false);});},250);
    return()=>{alive=false;clearTimeout(timer);};},[query,game.read]);
  return <View style={{gap:10}}>
    <TextInput value={query} onChangeText={setQuery} style={p.input} placeholder="지역 이름 검색" placeholderTextColor={palette.muted} accessibilityLabel="지역 이름 검색" autoCorrect={false}/>
    <ActionButton label="전국 지도 보기" secondary onPress={onOverview}/>
    {loading&&<ActivityIndicator color={palette.teal}/>}{error&&<Label accessibilityRole="alert">{error}</Label>}
    {!loading&&!error&&rows.length===0&&<Label muted>일치하는 지역이 없어요.</Label>}
    {rows.map(r=><Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`${r.fullName} 지역 정보`} onPress={()=>onInspect(r)} style={p.region}>
      <View style={{flex:1,gap:3}}><Label size={15}>{r.name}</Label><Label size={11} muted>{r.fullName}</Label></View><Icon name="chevron-forward"/>
    </Pressable>)}
  </View>;
}

export function RankingRows({rows,self,full=false,selfId}:{rows:Ranking[];self?:PersonalRankingInput;full?:boolean;selfId?:string}){
  const display=full?rows:rows.slice(0,3),highlightId=self?.id??selfId,record=self?derivePersonalRecord(rows,self):null;
  const row=(r:Ranking)=><View key={r.id} style={p.rankRow}>
    <View style={[p.rankNumber,{backgroundColor:r.id===highlightId?palette.teal:['#B5A16E','#92A0B9','#AD8B72'][Math.min(r.rank-1,2)]}]}><Label size={11} style={{color:palette.navy}}>{r.rank}</Label></View>
    <View style={{flex:1}}><Label size={full?14:11}>{r.name}{r.simulated?' · NPC':''}</Label>{full&&r.title&&<Label size={11} muted>{r.title}</Label>}</View>
    <Label size={full?13:10} muted>{number(r.steps)}</Label>
  </View>;
  const own=<View style={p.selfRank}><Label size={10} muted>{`내 기록 · ${record?.rankLabel}`}</Label><View style={p.rankRow}>
    <View style={[p.rankNumber,{backgroundColor:palette.teal}]}><Label size={record?.rank?11:9} style={{color:palette.navy}}>{record?.rank??'–'}</Label></View>
    <View style={{flex:1}}><Label size={full?14:11}>{record?.name}</Label></View>
    <Label size={full?13:10} muted>{`기여 ${number(record?.contribution??0)}`}</Label>
  </View></View>;
  return <View style={{gap:full?12:5}}>{full&&record&&own}{display.length?display.map(row):<Label size={11} muted>{self?.active?'아직 기여한 참가자가 없어요.':'공략을 시작하면 표시됩니다.'}</Label>}
    {!full&&record&&own}
  </View>;
}

export function AreaDetail({region,game,onStarted}:{region:Region;game:Game;onStarted:()=>void}){
  return <View style={{gap:16}}>
    <View style={p.row}><Label size={32}>{flags(region)}</Label><View style={{flex:1}}><Label size={21} style={p.bold}>{region.name}</Label><Label size={12} muted>{region.fullName}</Label></View></View>
    <Label>{region.description||`${region.fullName}의 행정구역입니다.`}</Label>
    <GlassPanel style={{padding:14,gap:6}}><Label size={12} muted>마지막 점령</Label>
      {region.capture?<><Label>{region.capture.teams.map(t=>`${t.flag} ${t.name}`).join(' · ')}</Label><Label size={12} muted>{dateLabel(region.capture.defeatedAt)}</Label></>:<Label>🏳️ 아직 점령된 적이 없어요.</Label>}
    </GlassPanel>
    {game.mode==='gps'&&<Label size={12} muted>시작할 때 현재 위치를 다시 확인해요. 이 지역 안에서 걸은 걸음만 반영됩니다.</Label>}
    <Label size={10} muted>행정 경계 기준 {game.snapshot?.dataInfo.date}</Label>
    <ActionButton label="공략 시작" disabled={game.busy} onPress={()=>void game.selectRegion(region.id).then(ok=>{if(ok)onStarted();})}/>
  </View>;
}

function ItemPreview({item}:{item:Item}){
  const {layout}=usePreferences();
  return <View accessible accessibilityLabel={`${item.name} 미리보기`} style={[p.preview,{width:76*layout.factor,height:76*layout.factor}]}>
    <Image source={require('../../assets/map.png')} style={StyleSheet.absoluteFill} resizeMode="cover"/>
    <View style={[StyleSheet.absoluteFill,{backgroundColor:'#101A2877'}]}/>
    <View style={{width:52*layout.factor,height:52*layout.factor,alignItems:'center',justifyContent:'center'}}>
      {item.slot==='frame'&&<NeonFrame/>}<Icon name="navigate-circle" size={32*layout.factor} color={palette.tealSoft}/>
      {item.slot==='badge'&&<View style={[p.badge,{backgroundColor:item.color}]}><Icon name="water" size={12} color={palette.navy}/></View>}
      {item.slot==='nameplate'&&<View style={[p.nameplate,{borderColor:item.color}]}><Label size={9} style={{color:item.color}}>나</Label></View>}
    </View>
  </View>;
}
export function ShopPanel({game}:{game:Game}){
  const [confirm,setConfirm]=useState<string|null>(null);const snapshot=game.snapshot!;
  return <View style={{gap:14}}>
    <View style={{alignItems:'flex-end'}}><Label style={{color:palette.tealSoft}} accessibilityLabel={`보유 포인트 ${snapshot.progress.points} P`}>{number(snapshot.progress.points)} P</Label></View>
    {snapshot.catalog.items.map(item=>{const owned=snapshot.progress.ownedItems.includes(item.id),equipped=snapshot.progress.equipment[item.slot]===item.id,short=Math.max(0,item.price-snapshot.progress.points);
      return <View key={item.id} style={{gap:5}}><GlassPanel style={{padding:12}}><View style={[p.row,{gap:14,flexWrap:'wrap'}]}><ItemPreview item={item}/>
        <View style={{flex:1,minWidth:120,gap:6}}><Label size={16} style={p.bold}>{item.name}</Label><Label size={17} style={{color:palette.tealSoft}}>{equipped?'적용 중':owned?'보유 중':`${item.price} P`}</Label></View></View></GlassPanel>
        {!owned&&short>0&&<Label size={11} muted>{short} P 부족</Label>}
        {confirm===item.id?<View><Label size={13}>{item.price} P로 구매할까요?</Label><View style={p.row}><View style={{flex:1}}><ActionButton label="구매 확정" disabled={game.busy} onPress={()=>void game.purchase(item.id).then(ok=>{if(ok)setConfirm(null);})}/></View><View style={{flex:1}}><ActionButton label="취소" secondary onPress={()=>setConfirm(null)}/></View></View></View>:
          <ActionButton label={owned?(equipped?'장착 해제':'장착하기'):`${item.price} P로 구매`} disabled={game.busy||(!owned&&short>0)} secondary={owned} onPress={()=>{if(owned)void game.equip(item.slot,equipped?null:item.id);else setConfirm(item.id);}}/>}
      </View>;})}
  </View>;
}

export function CollectionPanel({game,onShop,onHistory}:{game:Game;onShop:()=>void;onHistory:()=>void}){
  const snapshot=game.snapshot!,{progress,catalog}=snapshot;
  return <View style={{gap:14}}>
    <View style={p.between}><Label size={18}>나의 수집</Label><Label style={{color:palette.tealSoft}}>{number(progress.points)} P</Label></View>
    {progress.badges.map(b=><GlassPanel key={b.id} style={{padding:14}}><View style={p.row}><Icon name="ribbon-outline" size={28} color={palette.teal}/><View style={{flex:1}}><Label>{b.name}</Label><Label size={11} muted>{dateLabel(b.earnedAt)}</Label></View></View></GlassPanel>)}
    <Label size={15} style={p.bold}>칭호</Label>
    {catalog.titles.map(t=>{const earned=progress.earnedTitles.includes(t.id),equipped=progress.equipment.title===t.id;return <GlassPanel key={t.id} style={{padding:14,gap:5}}>
      <View style={p.row}><Icon name={earned?'ribbon-outline':'lock-closed-outline'} color={earned?palette.teal:palette.muted}/><Label style={{flex:1}}>{t.name}</Label></View>
      <Label size={12} muted>{t.description}</Label>
      {earned&&<ActionButton secondary label={equipped?'칭호 장착 해제':'칭호 장착'} disabled={game.busy} onPress={()=>void game.equip('title',equipped?null:t.id)}/>}
    </GlassPanel>;})}
    <Label size={12} muted>공략 성공 {progress.wins}회 · 탐험 지역 {progress.distinctRegions}곳</Label>
    <ActionButton label="공략 기록" secondary onPress={onHistory}/><ActionButton label="포인트로 꾸미기" onPress={onShop}/>
  </View>;
}
export function HistoryPanel({game}:{game:Game}){
  const [records,setRecords]=useState<Defeat[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const load=(offset:number)=>{setLoading(true);void game.read<{records:Defeat[];total:number}>(`/players/${game.snapshot!.player.id}/history?offset=${offset}&limit=30`)
    .then(r=>{setRecords(previous=>offset?[...previous,...r.records]:r.records);setTotal(r.total);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));};
  useEffect(()=>{load(0);},[]);
  return <View style={{gap:12}}>{records.map(r=><GlassPanel key={r.id} style={{padding:14,gap:4}}><Label>{r.regionName}</Label><Label size={12} muted>{dateLabel(r.defeatedAt)}</Label><Label size={12}>내 기여 {r.myContribution} · 1위 {r.teams.filter(t=>t.rank===1).map(t=>t.name).join(' · ')}</Label></GlassPanel>)}
    {!records.length&&!loading&&<Label muted>아직 완료한 공략 기록이 없어요.</Label>}{error&&<Label accessibilityRole="alert">{error}</Label>}{loading&&<ActivityIndicator color={palette.teal}/>}
    {records.length<total&&<ActionButton secondary label="더 보기" disabled={loading} onPress={()=>load(records.length)}/>}
  </View>;
}
const p=StyleSheet.create({input:{minHeight:52,paddingHorizontal:14,paddingVertical:12,borderRadius:12,borderWidth:1,borderColor:'#61799160',color:palette.text,fontSize:16,backgroundColor:'#101A2830'},
  row:{flexDirection:'row',alignItems:'center',gap:8},between:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},bold:{fontWeight:'600'},
  region:{minHeight:56,padding:12,borderRadius:12,borderWidth:1,borderColor:'#61799145',flexDirection:'row',alignItems:'center',gap:8},rankRow:{flexDirection:'row',alignItems:'center',gap:6},rankNumber:{width:22,height:22,borderRadius:11,alignItems:'center',justifyContent:'center'},selfRank:{borderTopWidth:1,borderTopColor:'#7C95B039',paddingTop:7,gap:5,marginTop:5},
  preview:{borderRadius:8,overflow:'hidden',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#72AAA650'},badge:{position:'absolute',right:1,top:1,width:18,height:18,borderRadius:9,alignItems:'center',justifyContent:'center'},nameplate:{position:'absolute',bottom:-3,borderWidth:1,borderRadius:4,paddingHorizontal:7,backgroundColor:palette.navy}});
