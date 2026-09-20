import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, Platform, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  defaults,
  layoutFor,
  parsePreferences,
  type Preferences,
} from "../theme";
const key = "walkwar.preferences.v1";
function useSettings() {
  const [prefs, setPrefs] = useState<Preferences>(defaults),
    [ready, setReady] = useState(false),
    [reduced, setReduced] = useState(false),
    [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const { width, fontScale } = useWindowDimensions();
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (live) setPrefs(parsePreferences(raw));
      })
      .catch(() => {
        if (live) setError("설정을 불러오지 못해 기본 크기로 열었어요.");
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let live = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then((v) => {
      if (live) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduced,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  const update = (next: Preferences) => {
    setPrefs(next);
    setError("");
    queue.current = queue.current
      .catch(() => {})
      .then(() => AsyncStorage.setItem(key, JSON.stringify(next)))
      .catch(() => setError("이번 선택은 적용됐지만 저장하지 못했어요."));
  };
  return {
    prefs,
    update,
    ready,
    error,
    solid: reduced || prefs.highContrast,
    reduced,
    layout: layoutFor(prefs.size, Math.min(width, 480), fontScale),
  };
}
const SettingsContext = createContext<ReturnType<typeof useSettings> | null>(
  null,
);
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useSettings();
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
export function usePreferences() {
  const v = useContext(SettingsContext);
  if (!v) throw new Error("SettingsProvider missing");
  return v;
}
