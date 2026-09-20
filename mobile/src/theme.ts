export const palette = {
  navy: "#101A28",
  text: "#EDF2F7",
  muted: "#B0BFD2",
  teal: "#72AAA6",
  tealSoft: "#A6CECB",
  line: "#52657A",
  surface: "#172639",
};
export const sizes = {
  compact: { label: "컴팩트", factor: 0.9, icon: 19, padding: 10 },
  standard: { label: "기본", factor: 1, icon: 22, padding: 12 },
  large: { label: "크게", factor: 1.22, icon: 27, padding: 16 },
} as const;
export type SizeChoice = keyof typeof sizes;
export type Preferences = { size: SizeChoice; highContrast: boolean };
export const defaults: Preferences = { size: "compact", highContrast: false };
export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return defaults;
  try {
    const v = JSON.parse(raw);
    return {
      size: v && Object.hasOwn(sizes, v.size) ? v.size : defaults.size,
      highContrast:
        typeof v?.highContrast === "boolean" ? v.highContrast : false,
    };
  } catch {
    return defaults;
  }
}
export function layoutFor(size: SizeChoice, width: number, fontScale: number) {
  const preset = sizes[size];
  return {
    ...preset,
    touchTarget: 48,
    collapseRanking: width < 360 || preset.factor * fontScale > 1.1,
    text: (base: number) => base * preset.factor,
  };
}
