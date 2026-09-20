import React from "react";
import { StyleSheet, View } from "react-native";
import { palette } from "../theme";

// Shared by the product preview and equipped map marker.
export function NeonFrame() {
  return (
    <View pointerEvents="none" accessible={false} style={styles.outer}>
      <View style={styles.inner} />
      <View style={[styles.spark, { top: "12%", right: "12%" }]} />
      <View style={[styles.spark, { bottom: "12%", left: "12%" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    ...StyleSheet.absoluteFill,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: "#72AAA64D",
    backgroundColor: "#72AAA615",
  },
  inner: {
    position: "absolute",
    inset: 3,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: palette.teal,
  },
  spark: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 1,
    transform: [{ rotate: "45deg" }],
    backgroundColor: palette.tealSoft,
  },
});
