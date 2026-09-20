import React from "react";
import { StyleSheet, View } from "react-native";
// Native iOS refraction comes from GlassView; this rim also supports the blur fallback.
export function LiquidSurface({ radius = 12 }: { radius?: number }) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          borderWidth: 1,
          borderTopColor: "#E3FFFBA0",
          borderLeftColor: "#DDF6F168",
          borderRightColor: "#85B8BC60",
          borderBottomColor: "#A6CECB70",
        },
      ]}
    />
  );
}
