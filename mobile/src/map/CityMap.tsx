import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { mapDocument } from "./document";
import { type CityMapProps } from "./regions";
import { useAreaLoader, type AreaDisplay } from "./useAreaLoader";
import { recordDiagnostic } from '../device/diagnostics';
const source = { html: mapDocument, baseUrl: "https://localhost/" };
export function CityMap(props: CityMapProps) {
  const ref = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const ready = useRef(false);
  const viewport = useRef<{ lng: number; lat: number; zoom: number } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const sendAreas = (areas: AreaDisplay) => {
    if (!ready.current) return;
    recordDiagnostic('map-areas', `level=${areas.level}; features=${areas.features.length}`);
    ref.current?.injectJavaScript(
      `window.receiveMapAreas&&window.receiveMapAreas(${JSON.stringify(areas)});true;`,
    );
  };
  const onViewport = useAreaLoader(props, sendAreas);
  const send = (restoreCamera = false) => {
    if (!ready.current) return;
    const p = latest.current;
    const data = {
      coordinate: p.coordinate,
      equipped: p.equipped,
      frameColor: p.frameColor,
      badgeColor: p.badgeColor,
      nameplateColor: p.nameplateColor,
      factor: p.factor,
      bottom: p.bottom,
      camera: restoreCamera && viewport.current ? { ...p.camera, ...viewport.current } : p.camera,
    };
    ref.current?.injectJavaScript(
      `window.receiveMapState&&window.receiveMapState(${JSON.stringify(data)});true;`,
    );
  };
  useEffect(() => send(), [
    props.coordinate?.lat,
    props.coordinate?.lng,
    props.equipped,
    props.frameColor,
    props.badgeColor,
    props.nameplateColor,
    props.factor,
    props.bottom,
    props.camera,
  ]);
  const unavailable = () => {
    ready.current = false;
    // Remove the terminated WebView instead of injecting into a dead renderer.
    setFailed(true);
  };
  if (failed) return <View style={[styles.map, styles.recovery]}>
    <Text accessibilityRole="alert" style={styles.message}>지도가 중지됐어요. 다시 불러와 주세요.</Text>
    <Pressable accessibilityRole="button" onPress={() => {
      ready.current = false;
      setGeneration(value => value + 1);
      setFailed(false);
    }} style={styles.retry}><Text style={styles.retryText}>지도 다시 불러오기</Text></Pressable>
  </View>;
  return (
    <WebView
      key={generation}
      ref={ref}
      source={source}
      style={styles.map}
      originWhitelist={["*"]}
      scrollEnabled={false}
      onLoadStart={() => { ready.current = false; }}
      onError={event => { recordDiagnostic('webview-error', `code=${event.nativeEvent.code}`); unavailable(); }}
      onRenderProcessGone={event => { recordDiagnostic('webview-process-gone', `didCrash=${event.nativeEvent.didCrash}`); unavailable(); }}
      onContentProcessDidTerminate={() => { recordDiagnostic('webview-process-terminated'); unavailable(); }}
      onShouldStartLoadWithRequest={(r) => {
        if (r.navigationType === "click" && /^https:\/\//.test(r.url)) {
          void Linking.openURL(r.url);
          return false;
        }
        return true;
      }}
      onMessage={(e) => {
        try {
          const v = JSON.parse(e.nativeEvent.data);
          if (v.channel !== "walkwar-map") return;
          if (v.type === "ready") { recordDiagnostic('map-ready'); ready.current = true; send(true); }
          if (v.type === "context-lost" || v.type === "context-restored") recordDiagnostic(v.type);
          if (v.type === "region" && v.region?.id) latest.current.onRegion(v.region);
          if (
            v.type === "viewport" &&
            [v.lng, v.lat, v.zoom, v.west, v.south, v.east, v.north].every(Number.isFinite)
          ) {
            viewport.current = { lng: v.lng, lat: v.lat, zoom: v.zoom };
            recordDiagnostic('map-zoom', `zoom=${v.zoom.toFixed(1)}`);
            latest.current.onCamera(v.lng, v.lat, v.zoom);
            onViewport(v);
          }
        } catch {}
      }}
    />
  );
}
const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFill, backgroundColor: "#101a28" },
  recovery: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  message: { color: '#dce7ef', textAlign: 'center' },
  retry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 12, backgroundColor: '#72aaa6' },
  retryText: { color: '#101a28' },
});
