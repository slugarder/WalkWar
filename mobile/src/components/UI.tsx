import React from "react";
import {
  Text,
  Pressable,
  StyleSheet,
  type TextProps,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { palette } from "../theme";
import { usePreferences } from "../state/preferences";
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function Label({
  size = 14,
  muted = false,
  style,
  ...props
}: TextProps & { size?: number; muted?: boolean }) {
  const { layout } = usePreferences();
  return (
    <Text
      {...props}
      style={[
        {
          fontSize: layout.text(size),
          color: muted ? palette.muted : palette.text,
          lineHeight: layout.text(size) * 1.45,
        },
        style,
      ]}
    />
  );
}
export function Icon({
  name,
  size,
  color = palette.muted,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const { layout } = usePreferences();
  return (
    <Ionicons
      name={name}
      size={size ?? layout.icon}
      color={color}
      aria-hidden
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
export function IconButton({
  name,
  label,
  onPress,
  style,
  ...props
}: PressableProps & {
  name: IconName;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.touch,
        style,
        pressed && { backgroundColor: "#72AAA625" },
      ]}
    >
      <Icon name={name} />
    </Pressable>
  );
}
export function ActionButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: disabled
            ? "#283748"
            : secondary
              ? "#26384C"
              : pressed
                ? "#98C8C2"
                : palette.teal,
        },
      ]}
    >
      <Label
        style={{
          color: disabled
            ? palette.muted
            : secondary
              ? palette.text
              : "#10272B",
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Label>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  touch: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  action: {
    minHeight: 48,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
});
