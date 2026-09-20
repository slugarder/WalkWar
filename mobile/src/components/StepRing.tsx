import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePreferences } from "../state/preferences";
import { Label } from "./UI";
export function StepRing({ steps }: { steps: number }) {
  const { layout } = usePreferences();
  const size = 58 * layout.factor,
    pct = Math.min(1, steps / 10000),
    c = 2 * Math.PI * 25;
  return (
    <View
      accessibilityRole="progressbar"
      aria-valuemin={0}
      aria-valuemax={10000}
      aria-valuenow={Math.min(steps, 10000)}
      accessibilityLabel="하루 목표 걸음"
      accessibilityValue={{
        min: 0,
        max: 10000,
        now: Math.min(steps, 10000),
        text: `${steps.toLocaleString()}보, 목표 ${Math.round(pct * 100)}퍼센트`,
      }}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 60 60">
        <Circle
          cx="30"
          cy="30"
          r="25"
          stroke="#344257"
          strokeWidth="5"
          fill="none"
        />
        <Circle
          cx="30"
          cy="30"
          r="25"
          stroke="#72AAA6"
          strokeWidth="5"
          fill="none"
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
      </Svg>
      <View style={s.center}>
        <Label size={14} style={{ color: "#A6CECB" }}>
          {Math.round(pct * 100)}%
        </Label>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
});
