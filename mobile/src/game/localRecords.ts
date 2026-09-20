import type { Defeat, PlayMode, Progress, Region, Snapshot } from "./types.ts";

export interface LocalPlayerRecord {
  playerId: string;
  name: string;
  mode: PlayMode;
  totalSteps: number;
  progress: Progress;
  region: Region | null;
  contribution: number;
  encounterId: string | null;
  history: Defeat[];
  savedAt: string;
}

export interface LocalRecordsEnvelope {
  schema: 1;
  clientId: string;
  lastMode: PlayMode | null;
  records: Partial<Record<PlayMode, LocalPlayerRecord>>;
}

export const LOCAL_RECORDS_KEY = "walkwar.records.v1:https://walkwar-production.up.railway.app";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const mode = (value: unknown): value is PlayMode => value === "virtual" || value === "gps";
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);

function progress(value: unknown): Progress | null {
  if (!object(value) || !object(value.equipment) ||
    !nonnegative(value.points) || !nonnegative(value.wins) || !nonnegative(value.distinctRegions) ||
    !Array.isArray(value.badges) || !strings(value.ownedItems) || !strings(value.earnedTitles)) return null;
  const equipment = value.equipment;
  if (!["frame", "badge", "nameplate", "title"].every((key) => nullableString(equipment[key]))) return null;
  if (!value.badges.every((badge) => object(badge) && string(badge.id) && string(badge.name) && string(badge.earnedAt))) return null;
  return {
    points: value.points, wins: value.wins, distinctRegions: value.distinctRegions,
    badges: value.badges.map((badge: { id: string; name: string; earnedAt: string }) => ({
      id: badge.id, name: badge.name, earnedAt: badge.earnedAt,
    })),
    ownedItems: [...value.ownedItems], earnedTitles: [...value.earnedTitles],
    equipment: {
      frame: equipment.frame as string | null, badge: equipment.badge as string | null,
      nameplate: equipment.nameplate as string | null, title: equipment.title as string | null,
    },
  };
}

function region(value: unknown): Region | null {
  if (!object(value) || !string(value.id) || !string(value.code) || !string(value.codeSystem) ||
    !string(value.name) || !string(value.fullName) || !["sido", "sigungu", "emd"].includes(String(value.level)) ||
    !nullableString(value.parentId)) return null;
  if (value.center !== null && (!object(value.center) ||
    typeof value.center.lat !== "number" || !Number.isFinite(value.center.lat) ||
    typeof value.center.lon !== "number" || !Number.isFinite(value.center.lon))) return null;
  // Region metadata is public/static. In particular, capture teams are omitted.
  return {
    id: value.id, code: value.code, codeSystem: value.codeSystem,
    name: value.name, fullName: value.fullName, level: value.level as Region["level"],
    parentId: value.parentId, center: value.center === null ? null : {
      lat: (value.center as { lat: number }).lat, lon: (value.center as { lon: number }).lon,
    },
  };
}

function history(value: unknown): Defeat[] | null {
  if (!Array.isArray(value)) return null;
  const result: Defeat[] = [];
  for (const defeat of value) {
    if (!object(defeat) || !string(defeat.id) || !string(defeat.regionId) ||
      !string(defeat.regionName) || !["sido", "sigungu", "emd"].includes(String(defeat.regionLevel)) ||
      !mode(defeat.mode) || !nonnegative(defeat.encounterNumber) ||
      !string(defeat.defeatedAt) || !nonnegative(defeat.myContribution)) return null;
    if (defeat.myContribution > 0) result.push({
      id: defeat.id, regionId: defeat.regionId, regionName: defeat.regionName,
      regionLevel: defeat.regionLevel as Defeat["regionLevel"], mode: defeat.mode,
      encounterNumber: defeat.encounterNumber, defeatedAt: defeat.defeatedAt,
      myContribution: defeat.myContribution, personal: [], teams: [],
    });
  }
  return result;
}

export function sanitizeRecord(value: unknown, expectedMode: PlayMode): LocalPlayerRecord | null {
  if (!object(value) || !string(value.playerId) || !value.playerId || !string(value.name) ||
    value.mode !== expectedMode || !nonnegative(value.totalSteps) ||
    !nonnegative(value.contribution) || !nullableString(value.encounterId) ||
    !string(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt))) return null;
  const ownProgress = progress(value.progress);
  const ownRegion = value.region === null ? null : region(value.region);
  const ownHistory = history(value.history);
  if (!ownProgress || (value.region !== null && !ownRegion) || !ownHistory) return null;
  return {
    playerId: value.playerId, name: value.name, mode: expectedMode,
    totalSteps: value.totalSteps, progress: ownProgress, region: ownRegion,
    contribution: value.contribution, encounterId: value.encounterId,
    history: ownHistory.filter((defeat) => defeat.mode === expectedMode).slice(0, 200),
    savedAt: value.savedAt,
  };
}

export function parseLocalRecords(raw: string | null): LocalRecordsEnvelope | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.schema !== 1 || !string(value.clientId) || !value.clientId ||
      !(value.lastMode === null || mode(value.lastMode)) || !object(value.records)) return null;
    const records: LocalRecordsEnvelope["records"] = {};
    for (const key of ["virtual", "gps"] as const) {
      if (value.records[key] !== undefined) {
        const record = sanitizeRecord(value.records[key], key);
        if (!record) return null;
        records[key] = record;
      }
    }
    return { schema: 1, clientId: value.clientId, lastMode: value.lastMode, records };
  } catch {
    return null;
  }
}

export function recordFromSnapshot(snapshot: Snapshot, previous?: LocalPlayerRecord): LocalPlayerRecord {
  const ownProgress = progress(snapshot.progress);
  const ownHistory = history(snapshot.history);
  const ownRegion = snapshot.region ? region(snapshot.region) : null;
  const samePlayer = previous?.playerId === snapshot.player.id;
  const defeats = new Map<string, Defeat>();
  if (samePlayer) for (const defeat of previous.history) defeats.set(defeat.id, defeat);
  for (const defeat of ownHistory ?? []) {
    if (defeat.mode === snapshot.player.mode) defeats.set(defeat.id, defeat);
  }
  return {
    playerId: snapshot.player.id, name: snapshot.player.name, mode: snapshot.player.mode,
    totalSteps: snapshot.player.totalSteps, progress: ownProgress ?? snapshot.progress,
    region: ownRegion ?? (snapshot.region === null && samePlayer ? previous.region : null),
    contribution: snapshot.region === null && samePlayer ? previous.contribution : (snapshot.raid?.selfContribution ?? 0),
    encounterId: snapshot.region === null && samePlayer ? previous.encounterId : (snapshot.raid?.encounterId ?? null),
    // Server history is a recent window; keep a bounded own-only local history.
    history: [...defeats.values()].sort((a, b) => b.defeatedAt.localeCompare(a.defeatedAt)).slice(0, 200),
    savedAt: new Date().toISOString(),
  };
}
