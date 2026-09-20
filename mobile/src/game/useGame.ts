import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, NativeModules, Platform } from "react-native";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { GameClient, type GameClientView, type GameStorage } from "./client.ts";

export { playerLocation } from "./client.ts";
export type { ControlAction, GpsSample, PlayMode, Slot, Snapshot } from "./types.ts";

export type UseGame = GameClientView & Pick<
  GameClient,
  | "connect"
  | "disconnect"
  | "selectRegion"
  | "purchase"
  | "equip"
  | "control"
  | "setDirection"
  | "setMovementEnabled"
  | "setGpsProvider"
  | "sendGps"
  | "findGpsTargets"
  | "read"
  | "retry"
  | "dismissError"
  | "flushLocalRecords"
>;

type LegacyPreferences = {
  server?: unknown;
  name?: unknown;
  clientId?: unknown;
};

function legacyPreferences(): { server?: string; name?: string; clientId?: string } | null {
  const value = NativeModules.WalkWarLegacyPreferences as LegacyPreferences | undefined;
  if (!value || typeof value !== "object") return null;
  return {
    ...(typeof value.server === "string" ? { server: value.server } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.clientId === "string" ? { clientId: value.clientId } : {}),
  };
}

/** React Native binding for the bounded HTTP game client. */
export function useGame(): UseGame {
  const clientRef = useRef<GameClient | null>(null);
  if (!clientRef.current)
    clientRef.current = new GameClient({
      storage: AsyncStorage as unknown as GameStorage,
      platform: Platform.OS,
      legacyPreferences: legacyPreferences(),
    });
  const client = clientRef.current;
  const actions = useMemo(
    () => ({
      connect: client.connect.bind(client),
      disconnect: client.disconnect.bind(client),
      selectRegion: client.selectRegion.bind(client),
      purchase: client.purchase.bind(client),
      equip: client.equip.bind(client),
      control: client.control.bind(client),
      setDirection: client.setDirection.bind(client),
      setMovementEnabled: client.setMovementEnabled.bind(client),
      setGpsProvider: client.setGpsProvider.bind(client),
      sendGps: client.sendGps.bind(client),
      findGpsTargets: client.findGpsTargets.bind(client),
      read: client.read.bind(client),
      retry: client.retry.bind(client),
      dismissError: client.dismissError.bind(client),
      flushLocalRecords: client.flushLocalRecords.bind(client),
    }),
    [client],
  );
  const view = useSyncExternalStore(
    (notify) => client.subscribe(notify),
    () => client.getView(),
    () => client.getView(),
  );
  useEffect(() => {
    void client.initialize();
    client.start();
    const subscription = AppState.addEventListener("change", (state) => {
      client.setForeground(state === "active");
      if (state !== "active") void client.flushLocalRecords();
    });
    return () => {
      subscription.remove();
      client.dispose();
      void client.flushLocalRecords();
    };
  }, [client]);
  return { ...view, ...actions };
}
