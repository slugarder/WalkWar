import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, View, StyleSheet } from 'react-native';
import { GlassPanel } from './GlassPanel';
import { Icon } from './UI';
import { palette } from '../theme';

/** A thumb control only during an active virtual raid; map gestures never move the player. */
export function VirtualStick({ onDirection }: { onDirection: (x:number,y:number)=>void }) {
  const [knob,setKnob] = useState({x:0,y:0});
  const callback=useRef(onDirection); callback.current=onDirection;
  const stop=()=>{ setKnob({x:0,y:0}); callback.current(0,0); };
  const responder=useRef(PanResponder.create({
    onStartShouldSetPanResponder:()=>true,
    onMoveShouldSetPanResponder:()=>true,
    onPanResponderMove:(_,g)=>{
      const length=Math.hypot(g.dx,g.dy), scale=Math.max(1,length/25);
      setKnob({x:g.dx/scale,y:g.dy/scale});
      callback.current(length<5?0:g.dx/scale/25,length<5?0:g.dy/scale/25);
    },
    onPanResponderRelease:stop, onPanResponderTerminate:stop,
    onPanResponderTerminationRequest:()=>false,
  })).current;
  useEffect(()=>()=>callback.current(0,0),[]);
  return <GlassPanel liquid style={s.outer}><View {...responder.panHandlers}
    accessible accessibilityRole="adjustable" accessibilityLabel="가상 이동 조이스틱"
    accessibilityHint="누른 채 원하는 방향으로 밀고, 손을 떼면 멈춥니다"
    style={s.pad} testID="virtual-stick">
    <View pointerEvents="none" style={[s.knob,{transform:[{translateX:knob.x},{translateY:knob.y}]}]}>
      <Icon name="navigate-outline" color={palette.tealSoft} size={22}/>
    </View>
  </View></GlassPanel>;
}
const s=StyleSheet.create({outer:{borderRadius:40},pad:{width:76,height:76,alignItems:'center',justifyContent:'center'},knob:{width:40,height:40,borderRadius:20,backgroundColor:'#72AAA629',borderWidth:1,borderColor:'#A6CECB60',alignItems:'center',justifyContent:'center'}});
