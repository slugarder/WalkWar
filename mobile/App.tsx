import React, {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,BackHandler,Image,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Switch,View,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,useSafeAreaInsets} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {BlurTargetView} from 'expo-blur';
import {useFonts} from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import {GlassPanel,BlurTargetContext} from './src/components/GlassPanel';
import {Icon,IconButton,Label,ActionButton} from './src/components/UI';
import {AreaDetail,CollectionPanel,ConnectScreen,HistoryPanel,RankingRows,RegionList,ShopPanel,dateLabel} from './src/components/GamePanels';
import {VirtualStick} from './src/components/VirtualStick';
import {DiagnosticsPanel} from './src/components/DiagnosticsPanel';
import {GpsTargetsPanel} from './src/components/GpsTargetsPanel';
import {CityMap} from './src/map/CityMap';
import {nationalCamera,regionCamera,type CameraCommand} from './src/map/regions';
import {SettingsProvider,usePreferences} from './src/state/preferences';
import {useGame,playerLocation} from './src/game/useGame';
import {derivePersonalRecord} from './src/game/ranking';
import {useGpsTracker} from './src/device/GpsTracker';
import {recordDiagnostic} from './src/device/diagnostics';
import type {Defeat,Region} from './src/game/types';
import {palette,sizes,type SizeChoice} from './src/theme';

type Panel='regions'|'targets'|'settings'|'ranking'|'collection'|'shop'|'raid'|'place'|'history'|null;
const teamColors=['#587087','#8A6D5C','#74677F','#60786E'];
const number=(value:number)=>value.toLocaleString('ko-KR');
const percent=(fraction:number)=>`${(fraction*100).toFixed(2)}%`;

function WalkWar(){
  const {layout,prefs,update,ready,error:preferencesError,reduced}=usePreferences();
  const [fontReady,fontError]=useFonts(Ionicons.font),game=useGame();
  const inset=useSafeAreaInsets(),{height}=useWindowDimensions();
  const [navHeight,setNavHeight]=useState(82),[camera,setCamera]=useState<CameraCommand>(nationalCamera);
  const liveCamera=useRef({lng:camera.lng,lat:camera.lat,zoom:camera.zoom});
  const [panel,setPanel]=useState<Panel>(null),[candidate,setCandidate]=useState<Region|null>(null);
  const [reward,setReward]=useState<Defeat|null>(null),[infoLoading,setInfoLoading]=useState(false),[infoError,setInfoError]=useState('');
  const target=useRef<View|null>(null),inspectSequence=useRef(0),seenHistory=useRef<{key:string;id:string}>({key:'',id:''});
  const snapshot=game.snapshot,raid=snapshot?.raid,region=snapshot?.region;
  const savedRecord=game.savedRecords[game.mode];
  const player=playerLocation(snapshot),equipment=snapshot?.progress.equipment;
  const gps=useGpsTracker(!!snapshot&&game.mode==='gps',snapshot?.sessionId||'',game.sendGps);
  useEffect(()=>{game.setGpsProvider(gps.refresh);return()=>game.setGpsProvider(null);},[game.setGpsProvider,gps.refresh]);
  useEffect(()=>{if(snapshot?.player.mode==='gps')recordDiagnostic('gps-result',`contribution=${raid?.selfContribution||0};${snapshot.gpsStatus||'waiting'}`);},[snapshot?.player.mode,snapshot?.gpsStatus,raid?.selfContribution]);
  const top=Math.max(inset.top,Platform.OS==='web'?22:8),bottom=Math.max(inset.bottom,16);
  const navigateMap=(lng:number,lat:number,zoom:number)=>{liveCamera.current={lng,lat,zoom};setCamera(c=>({id:c.id+1,lng,lat,zoom}));};
  const show=(next:Panel)=>{game.setDirection(0,0);setInfoError('');setPanel(next);};
  const close=()=>{++inspectSequence.current;show(null);setReward(null);};
  const inspect=async(area:Region,recenter=false)=>{
    const sequence=++inspectSequence.current;show('place');setCandidate(null);setInfoLoading(true);
    if(recenter){const c=regionCamera(area);navigateMap(c.lng,c.lat,c.zoom);}
    try{const result=await game.read<{region:Region}>(`/regions/${encodeURIComponent(area.id)}?mode=${game.mode}`);if(sequence===inspectSequence.current)setCandidate(result.region);}
    catch(e){if(sequence===inspectSequence.current)setInfoError((e as Error).message);}
    finally{if(sequence===inspectSequence.current)setInfoLoading(false);}
  };
  const loadAreas=useCallback(async(bounds:{west:number;south:number;east:number;north:number},level:'sido'|'city'|'sigungu'|'emd')=>game.read<{features:Array<{region:Region;geometry:any}>;truncated?:boolean}>(
    `/map/regions?west=${bounds.west}&south=${bounds.south}&east=${bounds.east}&north=${bounds.north}&level=${level==='city'?'sigungu&overview=true':level}&mode=${game.mode}&limit=200`),[game.read,game.mode]);
  useEffect(()=>{game.setMovementEnabled(!!snapshot&&!!raid&&!panel&&!reward&&raid.status==='running');return()=>game.setDirection(0,0);},[!!snapshot,!!raid,raid?.status,panel,reward,game.setMovementEnabled,game.setDirection]);
  useEffect(()=>{
    if(!snapshot)return;const key=`${snapshot.player.id}:${game.mode}`,last=snapshot.history[0];
    if(seenHistory.current.key!==key){seenHistory.current={key,id:last?.id||''};return;}
    if(last&&last.id!==seenHistory.current.id){seenHistory.current.id=last.id;if(last.myContribution>0){game.setDirection(0,0);setReward(last);}}
  },[snapshot?.history[0]?.id,snapshot?.player.id,game.mode]);
  useEffect(()=>{if(Platform.OS==='web')return;const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(panel||reward){close();return true;}return false;});return()=>sub.remove();},[panel,reward]);
  useEffect(()=>{
    if(Platform.OS!=='web')return;const keys=new Set<string>();
    const vector=()=>{const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));const y=Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'));game.setDirection(x,y);};
    const known=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    const down=(e:KeyboardEvent)=>{if(panel||reward||game.mode!=='virtual'||!raid||!known.includes(e.code)||(e.target as HTMLElement)?.closest('input,textarea,[role="radio"],[role="switch"]'))return;e.preventDefault();keys.add(e.code);vector();};
    const up=(e:KeyboardEvent)=>{if(keys.delete(e.code)){e.preventDefault();vector();}};
    const stop=()=>{keys.clear();game.setDirection(0,0);};window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',stop);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',stop);stop();};
  },[panel,reward,game.mode,!!raid,game.setDirection]);
  if(!ready||!game.ready||(!fontReady&&!fontError))return <View style={s.loading}><ActivityIndicator color={palette.teal}/></View>;
  if(!snapshot)return <KeyboardAvoidingView style={[s.screen,{justifyContent:'center'}]} behavior={Platform.OS==='ios'?'padding':undefined}>
    <StatusBar style="light"/><Image source={require('./assets/map.png')} style={s.map} resizeMode="cover"/><View style={[s.mapShade,{backgroundColor:'#101A2BDD'}]}/>
    <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center',paddingHorizontal:26,paddingTop:top+32,paddingBottom:bottom+32}} keyboardShouldPersistTaps="handled"><ConnectScreen game={game}/></ScrollView>
  </KeyboardAvoidingView>;
  const selfRecord={id:snapshot.player.id,name:snapshot.player.name,contribution:raid?.selfContribution||0,active:!!raid};
  const myRecord=derivePersonalRecord(raid?.currentPersonal||[],selfRecord);
  const fraction=raid?Math.max(0,Math.min(1,raid.hp/raid.maxHp)):0;
  const teams=raid?.currentTeams.filter(t=>t.steps>0)||[];
  const title=reward?`${reward.regionName} 공략 성공!`:{settings:'화면과 글자 크기',regions:'대한민국 둘러보기',targets:'내 위치에서 공략',ranking:'참여자 랭킹',collection:'나의 수집',shop:'탐험 상점',raid:raid?.bossName||'공략 정보',place:candidate?.name||'지역 정보',history:'공략 기록'}[panel||'settings'];
  const itemColor=(id:string|null|undefined)=>snapshot.catalog.items.find(i=>i.id===id)?.color;
  return <BlurTargetContext.Provider value={target}><View style={s.screen}><StatusBar style="light"/>
    <BlurTargetView ref={target} style={StyleSheet.absoluteFill}>
      <CityMap coordinate={player} equipped={!!equipment?.frame} frameColor={palette.teal} badgeColor={itemColor(equipment?.badge)} nameplateColor={itemColor(equipment?.nameplate)}
        factor={layout.factor} bottom={bottom+navHeight+8} camera={camera} refreshKey={`${game.mode}:${snapshot.history[0]?.id||''}`}
        onRegion={area=>void inspect(area)} onCamera={(lng,lat,zoom)=>{liveCamera.current={lng,lat,zoom};}} loadAreas={loadAreas}/>
    </BlurTargetView>
    <View pointerEvents="box-none" style={[s.top,{top:top+8}]}>
      <GlassPanel liquid style={{padding:layout.padding}}><Pressable accessibilityRole="button" accessibilityLabel={raid?`${raid.bossName} 상세, HP ${number(raid.hp)} / ${number(raid.maxHp)}`:'공략할 지역 선택'} onPress={()=>show(raid?'raid':'regions')} style={{minHeight:48,gap:7}}>
        <View style={s.row}><Label size={10} style={s.raidTag}>{raid?'RAID':'MAP'}</Label><Label size={18} style={[s.bold,{flex:1}]}>{raid?.bossName||'대한민국 탐험'}</Label><Icon name="chevron-forward" size={14*layout.factor}/></View>
        {raid?<View style={[s.row,{flexWrap:'wrap',gap:10}]}><Label size={11} muted style={{flexShrink:1}}>HP {number(raid.hp)} / {number(raid.maxHp)}</Label><View style={[s.track,{flex:1,minWidth:60}]}><View style={{width:`${fraction*100}%`,flexDirection:'row',height:'100%'}}>
          {teams.length?teams.map((team,i)=><View key={team.id} style={{backgroundColor:teamColors[i%4],flex:team.steps}}/>):<View style={{flex:1,backgroundColor:teamColors[0]}}/>}
        </View></View><Label size={12} style={[s.teal,{fontVariant:['tabular-nums']}]}>{percent(fraction)}</Label></View>:
          <Label size={11} muted>국기를 선택해 공략을 시작하세요.</Label>}
      </Pressable></GlassPanel>
      {!raid&&savedRecord?.region&&<GlassPanel liquid><Pressable accessibilityRole="button" accessibilityLabel={`${savedRecord.region.fullName} 이전 공략 이어하기`} disabled={game.busy} onPress={()=>void game.selectRegion(savedRecord.region!.id)} style={{minHeight:48,padding:12,gap:4}}>
        <Label size={13}>이전 공략 이어하기 · {savedRecord.region.name}</Label>
        <Label size={11} muted>마지막 확인 기여 {number(savedRecord.contribution)}{game.mode==='gps'?' · 현재 위치 확인 후 시작':''}</Label>
      </Pressable></GlassPanel>}
      <View pointerEvents="box-none" style={[s.hudRow,layout.collapseRanking&&{alignItems:'flex-start'}]}>
        <GlassPanel liquid><Pressable accessibilityRole="button" accessibilityLabel="전국 지역 선택" onPress={()=>show('regions')} style={[s.row,{minHeight:48,paddingHorizontal:12}]}>
          <Icon name={game.mode==='gps'?'locate-outline':'map-outline'} color={palette.tealSoft}/><Label size={12}>{region?.name||'전국'} · {game.mode==='gps'?'GPS':'가상'}</Label><Icon name="chevron-down" size={12}/>
        </Pressable></GlassPanel>
        {!raid&&savedRecord?<GlassPanel style={{width:178,padding:10,gap:5}}><Label size={12}>내 저장 기록</Label><Label size={13} style={s.teal}>{number(savedRecord.totalSteps)}걸음 · {number(savedRecord.progress.points)} P</Label><Label size={11} muted>최근 공략 기여 {number(savedRecord.contribution)}</Label></GlassPanel>:layout.collapseRanking?<GlassPanel><Pressable accessibilityRole="button" accessibilityLabel={`내 기록 ${myRecord.rankLabel}, 기여 ${myRecord.contribution}. 참여자 랭킹 보기`} onPress={()=>show('ranking')} style={[s.row,{minHeight:48,padding:10}]}><Icon name="podium-outline" color={palette.teal}/><View><Label size={11}>내 기록 · {myRecord.rankLabel}</Label><Label size={13} style={s.teal}>기여 {myRecord.contribution.toLocaleString('ko-KR')}</Label></View></Pressable></GlassPanel>:
          <GlassPanel style={{width:178,padding:10}}><Pressable accessibilityRole="button" onPress={()=>show('ranking')} style={[s.between,{minHeight:32}]}><Label size={12}>참여자 랭킹</Label><Icon name="chevron-forward" size={14}/></Pressable><RankingRows rows={raid?.currentPersonal||[]} selfId={snapshot.player.id} self={selfRecord}/></GlassPanel>}
      </View>
    </View>
    <View style={[s.mapActions,{bottom:bottom+navHeight+12}]}>
      <GlassPanel liquid><IconButton name="add" label="지도 확대" onPress={()=>{const c=liveCamera.current;navigateMap(c.lng,c.lat,Math.min(18,c.zoom+1));}}/><IconButton name="remove" label="지도 축소" onPress={()=>{const c=liveCamera.current;navigateMap(c.lng,c.lat,Math.max(2,c.zoom-1));}}/></GlassPanel>
      <GlassPanel liquid><IconButton name="options-outline" label="화면 크기 설정" onPress={()=>show('settings')}/></GlassPanel>
      <GlassPanel liquid><IconButton name="locate-outline" label="내 위치로" onPress={()=>{if(player)navigateMap(player.lng,player.lat,14);else navigateMap(nationalCamera.lng,nationalCamera.lat,nationalCamera.zoom);}}/></GlassPanel>
    </View>
    {game.mode==='virtual'&&raid&&raid.status==='running'&&!panel&&!reward&&<View style={{position:'absolute',left:12,bottom:bottom+navHeight+12}}><VirtualStick onDirection={game.setDirection}/></View>}
    {game.mode==='gps'&&<View style={{position:'absolute',left:12,right:78,bottom:bottom+navHeight+12,gap:8}}>
      <GlassPanel style={{padding:10}}><Label size={11}>{gps.available?(snapshot.gpsStatus||gps.status):gps.status}</Label></GlassPanel>
      <GlassPanel liquid><Pressable accessibilityRole="button" accessibilityLabel="내 위치에서 공략할 지역 찾기" disabled={game.busy} onPress={()=>{game.dismissError();show('targets');}} style={[s.row,{minHeight:48,paddingHorizontal:14}]}><Icon name="locate-outline" color={palette.tealSoft}/><Label size={13}>내 위치에서 공략</Label><Icon name="chevron-forward" size={14}/></Pressable></GlassPanel>
    </View>}
    {!panel&&(game.error||game.storageError)&&<View style={{position:'absolute',left:12,right:12,bottom:bottom+navHeight+100}}><GlassPanel style={{padding:12}}><Label accessibilityRole="alert" size={12}>{game.error||game.storageError}</Label><ActionButton secondary label="다시 시도" onPress={()=>void(game.error?game.retry():game.flushLocalRecords())}/></GlassPanel></View>}
    <GlassPanel liquid onLayout={e=>setNavHeight(e.nativeEvent.layout.height)} style={[s.nav,{bottom,left:12,right:12,padding:5}]}>
      {([{name:'map-outline',label:'지도',id:null},{name:'podium-outline',label:'순위',id:'ranking'},{name:'ribbon-outline',label:'수집',id:'collection'},{name:'cart-outline',label:'상점',id:'shop'}]as const).map(tab=><Pressable key={tab.label} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{selected:panel===tab.id}} aria-selected={panel===tab.id} onPress={()=>show(tab.id)} style={[s.navItem,{paddingVertical:layout.padding},panel===tab.id&&{backgroundColor:'#72AAA620'}]}><Icon name={tab.name} color={panel===tab.id?palette.tealSoft:palette.muted}/><Label size={12} style={panel===tab.id?s.teal:null}>{tab.label}</Label></Pressable>)}
    </GlassPanel>
    <Modal visible={!!panel||!!reward} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={s.modalOuter}><Pressable accessibilityRole="button" accessibilityLabel="상세 화면 닫기" style={StyleSheet.absoluteFill} onPress={close}/>
        <View style={[s.sheet,{maxHeight:Math.max(300,height-inset.top-36),paddingBottom:bottom}]}><View style={s.sheetHeader}><Label size={21} style={[s.bold,{flex:1}]}>{title}</Label><IconButton name="close" label="닫기" onPress={close}/></View>
          <ScrollView contentContainerStyle={{paddingHorizontal:22,paddingBottom:24,gap:16}} keyboardShouldPersistTaps="handled">
            {panel!=='targets'&&(game.busy||infoLoading)&&<ActivityIndicator color={palette.teal}/>}
            {panel!=='targets'&&(game.error||infoError)&&<View style={{gap:6}}><Label accessibilityRole="alert" size={13}>{game.error||infoError}</Label><ActionButton secondary label="다시 시도" disabled={game.busy} onPress={()=>{if(infoError&&candidate)void inspect(candidate);else void game.retry();}}/></View>}
            {reward?<><View style={s.reward}><Icon name="ribbon-outline" size={64} color={palette.teal}/><Label size={34} style={s.teal}>+100 P</Label><Label>내 기여 {reward.myContribution}</Label></View><ActionButton label="수집 확인" onPress={()=>{setReward(null);show('collection');}}/><ActionButton label="계속 탐험하기" secondary onPress={close}/></>:<>
              {panel==='regions'&&<>{game.mode==='gps'&&<ActionButton label="내 위치에서 공략할 지역 찾기" disabled={game.busy} onPress={()=>{game.dismissError();show('targets');}}/>}<RegionList game={game} onInspect={r=>void inspect(r,true)} onOverview={()=>{navigateMap(nationalCamera.lng,nationalCamera.lat,nationalCamera.zoom);close();}}/></>}
              {panel==='targets'&&<GpsTargetsPanel game={game} onInspect={r=>void inspect(r)} onLocated={(lat,lon)=>navigateMap(lon,lat,14)}/>}
              {panel==='place'&&candidate&&<AreaDetail region={candidate} game={game} onStarted={close}/>}
              {panel==='settings'&&<><View accessibilityRole="radiogroup" accessibilityLabel="화면 크기 선택" style={{gap:10}}>{(Object.keys(sizes)as SizeChoice[]).map(choice=><Pressable key={choice} testID={`size-${choice}`} accessibilityRole="radio" accessibilityState={{checked:prefs.size===choice}} aria-checked={prefs.size===choice} accessibilityLabel={sizes[choice].label} onPress={()=>update({...prefs,size:choice})} style={[s.sizeOption,{padding:layout.padding},prefs.size===choice&&s.sizeSelected]}><Icon name={prefs.size===choice?'radio-button-on':'radio-button-off'} color={palette.teal}/><View style={{flex:1}}><Label size={17} style={s.bold}>{sizes[choice].label}</Label></View><Label size={choice==='large'?23:choice==='standard'?19:16}>가</Label></Pressable>)}</View>
                <View style={s.between}><View style={{flex:1,paddingRight:10}}><Label>배경 대비 높이기</Label>{reduced&&<Label size={12} muted>기기 설정 적용 중</Label>}</View><Switch accessibilityLabel="배경 대비 높이기" value={prefs.highContrast} onValueChange={highContrast=>update({...prefs,highContrast})} trackColor={{false:'#425065',true:palette.teal}}/></View>
                {preferencesError&&<Label accessibilityRole="alert">{preferencesError}</Label>}
                <ActionButton secondary label="이동 모드 변경" onPress={()=>{close();game.disconnect();seenHistory.current={key:'',id:''};}}/>
                <DiagnosticsPanel/>
              </>}
              {panel==='ranking'&&<><Label size={13} muted>{region?.fullName||'공략 지역을 선택해 주세요.'}</Label><RankingRows rows={raid?.currentPersonal||[]} selfId={snapshot.player.id} self={selfRecord} full/>
                {game.mode==='gps'&&<GlassPanel style={{padding:14,gap:6}}><Label size={14}>걸음 확인</Label><Label size={13}>현재 추적에서 감지 {gps.detectedSteps.toLocaleString('ko-KR')}걸음</Label><Label size={12} muted>{!gps.available?gps.status:gps.stepEvents===0?'걸음 센서의 첫 입력을 기다리고 있어요.':snapshot.gpsStatus||gps.status}</Label><Label size={11} muted>현재 추적은 공략 선택 또는 앱 복귀 때 새로 시작합니다. 기여는 선택 지역에서 확인된 걸음만 반영됩니다.</Label></GlassPanel>}
                {!!raid?.currentTeams.length&&<><Label size={16} style={s.bold}>팀 순위</Label><RankingRows rows={raid.currentTeams} selfId="" full/></>}
                {raid?.latestDefeat&&<><Label size={13} muted>마지막 점령 · {dateLabel(raid.latestDefeat.defeatedAt)}</Label><RankingRows rows={raid.latestDefeat.teams} selfId="" full/></>}
                <ActionButton secondary label="전체 공략 기록" onPress={()=>show('history')}/></>}
              {panel==='collection'&&<CollectionPanel game={game} onShop={()=>show('shop')} onHistory={()=>show('history')}/>}
              {panel==='shop'&&<ShopPanel game={game}/>}
              {panel==='history'&&<HistoryPanel game={game}/>}
              {panel==='raid'&&raid&&<><Label size={21} style={s.bold}>{region?.fullName}</Label><Label>HP {number(raid.hp)} / {number(raid.maxHp)}</Label><Label size={13} muted>내 기여 {number(raid.selfContribution)} · {raid.status==='paused'?'일시 정지':'공략 중'}</Label><ActionButton disabled={game.busy} label={raid.status==='paused'?'공략 재개':'잠시 쉬기'} onPress={()=>void game.control(raid.status==='paused'?'resume':'pause')}/><ActionButton secondary label="점령 기록" onPress={()=>show('history')}/></>}
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View></BlurTargetContext.Provider>;
}

export default function App(){return <SafeAreaProvider><SettingsProvider><View style={s.stage}><WalkWar/></View></SettingsProvider></SafeAreaProvider>;}
const s = StyleSheet.create({
  stage: { flex: 1, backgroundColor: "#080F18", alignItems: "center" },
  screen: {
    flex: 1,
    width: "100%",
    maxWidth: Platform.OS === "web" ? 480 : undefined,
    backgroundColor: palette.navy,
    overflow: "hidden",
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  map: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  mapShade: { ...StyleSheet.absoluteFill, backgroundColor: "#101A2830" },
  top: { position: "absolute", left: 12, right: 12, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  bold: { fontWeight: "600" },
  teal: { color: palette.tealSoft },
  raidTag: {
    borderWidth: 1,
    borderColor: palette.teal,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    color: palette.tealSoft,
  },
  track: {
    height: 7,
    backgroundColor: "#233044",
    borderRadius: 8,
    overflow: "hidden",
  },
  hudRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
  },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rankNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  myRank: {
    borderTopWidth: 1,
    borderTopColor: "#7C95B039",
    paddingTop: 7,
    gap: 5,
    marginTop: 5,
  },
  landmark: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  player: {
    position: "absolute",
    backgroundColor: "#72AAA622",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  meTag: {
    position: "absolute",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: palette.teal,
  },
  park: { position: "absolute", alignItems: "center", gap: 4 },
  themePreview: {
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#72AAA650",
  },
  place: {
    right: 16,
    top: "74%",
    minHeight: 48,
    padding: 8,
    backgroundColor: "#101A2899",
    borderRadius: 15,
  },
  mapActions: { position: "absolute", right: 12, gap: 8 },
  nav: { position: "absolute", flexDirection: "row", gap: 4, borderRadius: 30 },
  navItem: {
    minWidth: 48,
    minHeight: 56,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: 24,
  },
  modalOuter: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#0007",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: "#6C8C9E50",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 22,
    paddingRight: 10,
    paddingVertical: 14,
    gap: 12,
  },
  sizeOption: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#61799160",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sizeSelected: { backgroundColor: "#72AAA61F", borderColor: palette.teal },
  reward: { alignItems: "center", paddingVertical: 22, gap: 12 },
  alley: { width: "100%", height: 180, borderRadius: 16 },
});
