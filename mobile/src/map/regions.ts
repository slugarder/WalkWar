import type { Region } from "../game/types";

export type CameraCommand = {
  id: number;
  lng: number;
  lat: number;
  zoom: number;
};

export type AreaLevel = "sido" | "city" | "sigungu" | "emd";
export type MapBounds = { west: number; south: number; east: number; north: number };
export type MapArea = { region: Region; geometry: unknown };
export type MapAreas = { features: MapArea[]; truncated?: boolean };

export type CityMapProps = {
  coordinate: { lat: number; lng: number } | null;
  equipped: boolean;
  frameColor?: string;
  badgeColor?: string;
  nameplateColor?: string;
  factor: number;
  bottom: number;
  camera: CameraCommand;
  refreshKey?: string;
  onCamera: (lng: number, lat: number, zoom: number) => void;
  onRegion: (region: Region) => void;
  loadAreas: (bounds: MapBounds, level: AreaLevel) => Promise<MapAreas>;
};

// MapLibre uses 512 px tiles. This fits the peninsula and Jeju on a phone map.
export const nationalCamera: CameraCommand = {
  id: 0,
  lng: 127.55,
  lat: 36.05,
  zoom: 6,
};

export function levelForZoom(zoom: number): AreaLevel | null {
  if (!Number.isFinite(zoom) || zoom < 4.75) return null;
  if (zoom < 7.3) return "sido";
  if (zoom < 9.4) return "city";
  if (zoom < 12.2) return "sigungu";
  return "emd";
}

export function regionCamera(region: Region, id = Date.now()): CameraCommand {
  return {
    id,
    lng: region.center?.lon ?? nationalCamera.lng,
    lat: region.center?.lat ?? nationalCamera.lat,
    zoom: region.level === "sido" ? 7.3 : region.level === "emd" ? 14 : region.isAggregateCity ? 9.4 : 11,
  };
}
