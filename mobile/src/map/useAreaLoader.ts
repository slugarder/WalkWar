import { useCallback, useEffect, useRef } from 'react';
import type { CityMapProps } from './regions';
import { createAreaRequests, type AreaDisplay, type MapViewport } from './areaRequests';
export type { AreaDisplay, MapViewport } from './areaRequests';

export function useAreaLoader(props: CityMapProps, send: (data: AreaDisplay) => void) {
  const latest = useRef(props);
  const sendLatest = useRef(send);
  const viewport = useRef<MapViewport | null>(null);
  const requests = useRef<ReturnType<typeof createAreaRequests> | null>(null);
  latest.current = props;
  sendLatest.current = send;
  const getRequests = () => requests.current ??= createAreaRequests(
    (bounds, level) => latest.current.loadAreas(bounds, level),
    (data) => sendLatest.current(data),
  );
  const schedule = useCallback((next: MapViewport) => {
    viewport.current = next;
    getRequests().schedule(next);
  }, []);
  useEffect(() => {
    if (viewport.current) schedule(viewport.current);
  }, [props.refreshKey, schedule]);
  useEffect(() => () => {
    requests.current?.dispose();
    requests.current = null;
  }, []);
  return schedule;
}
