import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, View} from 'react-native';
import type {UseGame} from '../game/useGame';
import type {Region} from '../game/types';
import {palette} from '../theme';
import {ActionButton, Icon, Label} from './UI';

function areaKind(region: Region): string {
  if (region.level === 'sido') return '시·도';
  if (region.level === 'emd') return '읍·면·동';
  if (region.isAggregateCity || region.name.endsWith('시')) return '시';
  return region.name.endsWith('군') ? '군' : '구';
}

/** Finding candidates never starts an attack; each row opens the usual detail. */
export function GpsTargetsPanel({game, onInspect, onLocated}: {
  game: UseGame;
  onInspect: (region: Region) => void;
  onLocated: (lat: number, lon: number) => void;
}) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const locatedRef = useRef(onLocated);
  locatedRef.current = onLocated;
  useEffect(() => {
    let alive = true;
    setLoading(true); setFailed(false); setRegions([]);
    void game.findGpsTargets().then(result => {
      if (!alive) return;
      if (result) {
        setRegions(result.regions);
        locatedRef.current(result.lat, result.lon);
      } else setFailed(true);
    }).catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [game.findGpsTargets, attempt]);
  return <View style={{gap:12}}>
    <Label size={13} muted>현재 위치에 속한 지역을 찾아드려요. 지역을 선택하면 설명을 보고 공략을 시작할 수 있어요.</Label>
    {loading ? <View style={{gap:10, paddingVertical:16}}><ActivityIndicator color={palette.teal}/><Label size={13}>현재 위치를 확인하고 있어요…</Label></View> : <>
      {failed ? <Label accessibilityRole="alert" size={13}>{game.error || '현재 위치를 확인하지 못했어요. 다시 찾아 주세요.'}</Label> :
        regions.length === 0 ? <Label size={13}>공략 가능한 행정구역을 찾지 못했어요.</Label> :
        regions.map(region => <Pressable key={region.id} accessibilityRole="button" accessibilityLabel={`${region.fullName} 지역 정보`}
          onPress={() => onInspect(region)} style={{minHeight:64, padding:14, borderRadius:12, backgroundColor:'#26384C', flexDirection:'row', alignItems:'center', gap:12}}>
          <Label size={11} style={{color:palette.tealSoft, minWidth:42}}>{areaKind(region)}</Label>
          <View style={{flex:1, gap:3}}><Label size={16}>{region.name}</Label><Label size={11} muted>{region.fullName}</Label></View>
          <Icon name="chevron-forward"/>
        </Pressable>)}
      <ActionButton secondary label="현재 위치로 다시 찾기" disabled={game.busy} onPress={() => setAttempt(value => value + 1)}/>
    </>}
  </View>;
}
