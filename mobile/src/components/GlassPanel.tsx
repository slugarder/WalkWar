import React, { createContext, useContext, type RefObject } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { usePreferences } from "../state/preferences";
import { LiquidSurface } from "./LiquidSurface";
export const BlurTargetContext = createContext<
  RefObject<View | null> | undefined
>(undefined);
export function GlassPanel({
  children,
  style,
  liquid = false,
  ...props
}: ViewProps & { liquid?: boolean }) {
  const { solid } = usePreferences();
  const target = useContext(BlurTargetContext);
  const native =
    Platform.OS === "ios" &&
    isGlassEffectAPIAvailable() &&
    isLiquidGlassAvailable();
  return (
    <View
      {...props}
      style={[
        styles.panel,
        liquid &&
          !solid && {
            borderColor: "transparent",
            boxShadow: "0 5px 18px #00000025",
          },
        style,
      ]}
    >
      {solid ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.solid]}
        />
      ) : liquid && Platform.OS === "web" ? (
        <LiquidSurface
          radius={Number(StyleSheet.flatten(style)?.borderRadius) || 12}
        />
      ) : native ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle={liquid ? "clear" : "regular"}
          colorScheme="dark"
          tintColor={liquid ? "#101A2810" : "#101A2830"}
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius:
                Number(StyleSheet.flatten(style)?.borderRadius) || 12,
            },
          ]}
        />
      ) : (
        <BlurView
          pointerEvents="none"
          tint="dark"
          intensity={35}
          blurTarget={target}
          blurMethod="dimezisBlurViewSdk31Plus"
          style={[StyleSheet.absoluteFill, styles.fallback]}
        />
      )}
      {liquid && !solid && Platform.OS !== "web" && !native ? (
        <LiquidSurface
          radius={Number(StyleSheet.flatten(style)?.borderRadius) || 12}
        />
      ) : null}
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#97BDD133",
  },
  solid: { backgroundColor: "#172639" },
  fallback: { backgroundColor: "#101A2859" },
});
