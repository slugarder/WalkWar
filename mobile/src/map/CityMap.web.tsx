import React, { useEffect, useRef } from "react";
import { mapDocument } from "./document";
import { type CityMapProps } from "./regions";
import { useAreaLoader, type AreaDisplay } from "./useAreaLoader";

export function CityMap(props: CityMapProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const sendAreas = (areas: AreaDisplay) => {
    frame.current?.contentWindow?.postMessage(
      { channel: "walkwar-map-areas", ...areas },
      "*",
    );
  };
  const onViewport = useAreaLoader(props, sendAreas);
  const send = () => {
    const p = latest.current;
    frame.current?.contentWindow?.postMessage(
      {
        channel: "walkwar-map-state",
        coordinate: p.coordinate,
        equipped: p.equipped,
        frameColor: p.frameColor,
        badgeColor: p.badgeColor,
        nameplateColor: p.nameplateColor,
        factor: p.factor,
        bottom: p.bottom,
        camera: p.camera,
      },
      "*",
    );
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const v = JSON.parse(event.data);
        if (v.channel !== "walkwar-map") return;
        if (v.type === "ready") send();
        if (v.type === "region" && v.region?.id) latest.current.onRegion(v.region);
        if (
          v.type === "viewport" &&
          [v.lng, v.lat, v.zoom, v.west, v.south, v.east, v.north].every(Number.isFinite)
        ) {
          latest.current.onCamera(v.lng, v.lat, v.zoom);
          onViewport(v);
        }
      } catch {}
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(send, [
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
  return (
    <iframe
      ref={frame}
      title="대한민국 지도"
      srcDoc={mapDocument}
      onLoad={send}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
      }}
    />
  );
}
