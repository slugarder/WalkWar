import assert from "node:assert/strict";
import test from "node:test";
import { GameClient, RAILWAY_SERVER_URL, type GameStorage } from "../src/game/client.ts";
import { LOCAL_RECORDS_KEY } from "../src/game/localRecords.ts";
import type { PlayMode, Snapshot } from "../src/game/types.ts";

const idKey = `walkwar.client.v1:${RAILWAY_SERVER_URL}`;
class MemoryStorage implements GameStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  failRecords = false;
  failIdentityRead = false;
  gate: Promise<void> | null = null;
  async getItem(key: string): Promise<string | null> {
    if (key === idKey && this.failIdentityRead) throw new Error("identity read failed");
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (key === LOCAL_RECORDS_KEY) {
      this.writes.push(value);
      if (this.failRecords) throw new Error("storage full");
      if (this.gate) await this.gate;
    }
    this.values.set(key, value);
  }
}

function snapshot(mode: PlayMode, regionId: string | null = null, steps = 0): Snapshot {
  return {
    player: { id: "own-player", name: "Walker", mode, totalSteps: steps, regionId,
      xM: 60, yM: 40, lat: 35.1, lon: 129 },
    sessionId: `${mode}-${regionId ?? "browse"}`, worldVersion: 1,
    serverTime: new Date().toISOString(),
    region: regionId ? { id: regionId, code: "1", codeSystem: "test", name: regionId,
      fullName: regionId, level: "emd", parentId: null, center: { lat: 35.1, lon: 129 },
      capture: { defeatedAt: "2026-09-20", encounterNumber: 1,
        teams: [{ id: "other", name: "Other", country: null, rank: 1, flag: "" }] } } : null,
    regionPath: [],
    raid: regionId ? { encounterId: `${mode}-encounter`, number: 1, bossName: "Boss",
      hp: 40, maxHp: 100, status: "running", selfContribution: steps,
      currentPersonal: [], currentTeams: [], latestDefeat: null } : null,
    participants: [{ id: "other", name: "Other", xM: 1, yM: 2,
      lat: 35.2, lon: 129.2, steps: 50, simulated: false, teamId: "other",
      title: null, frame: null }],
    progress: { points: steps + 100, badges: [{ id: "badge", name: "First", earnedAt: "2026-09-20" }],
      ownedItems: ["frame-1"], earnedTitles: ["title-1"],
      equipment: { frame: "frame-1", badge: null, nameplate: null, title: "title-1" },
      wins: 1, distinctRegions: 1 },
    catalog: { items: [], titles: [] }, gpsStatus: null,
    history: [{ id: "own-win", regionId: "previous", regionName: "Previous", regionLevel: "emd",
      mode, encounterNumber: 1, defeatedAt: "2026-09-20T00:00:00Z", myContribution: 5,
      personal: [{ id: "other", name: "Other", teamId: "other", teamName: "Other",
        rank: 1, steps: 50, simulated: false, country: null, title: null, frame: null }], teams: [] },
      { id: "someone-else", regionId: "other", regionName: "Other", regionLevel: "emd",
        mode, encounterNumber: 2, defeatedAt: "2026-09-20T01:00:00Z", myContribution: 0,
        personal: [], teams: [] }],
    dataInfo: { date: "2026-09-20", source: "test", regionCount: 1 },
  };
}

function server() {
  const calls: string[] = [];
  let steps = 0;
  let selected: string | null = null;
  const fetcher: typeof globalThis.fetch = async (url, init) => {
    const path = String(url);
    calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) as { mode?: PlayMode; regionId?: string; clientId?: string } : {};
    if (path.endsWith("/players")) {
      assert.ok(body.clientId);
      return response(snapshot("virtual"));
    }
    if (path.endsWith("/session")) {
      selected = body.regionId ?? null;
      return response(snapshot(body.mode ?? "virtual", selected, steps));
    }
    if (path.endsWith("/gps")) return response(snapshot("gps", selected, steps));
    if (path.endsWith("/state")) return response(snapshot("gps", selected, steps));
    throw new Error(`unexpected ${path}`);
  };
  return { fetcher, calls, setSteps(value: number) { steps = value; } };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

test("restart restores two own-mode records without rejoining, GPS, or cached live state", async () => {
  const storage = new MemoryStorage();
  const api = server();
  const first = new GameClient({ storage, fetch: api.fetcher });
  assert.equal(await first.connect("Walker", "virtual"), true);
  api.setSteps(12);
  assert.equal(await first.selectRegion("virtual-region"), true);
  const identity = storage.values.get(idKey);
  api.setSteps(20);
  assert.equal(await first.connect("Walker", "gps"), true);
  first.setGpsProvider(async () => ({ lat: 35.1, lon: 129, accuracyM: 5,
    capturedAt: Date.now(), stepCounter: 20, sensorEpoch: "fresh-device" }));
  assert.equal(await first.selectRegion("gps-region"), true);
  await first.flushLocalRecords();
  const persisted = storage.values.get(LOCAL_RECORDS_KEY) ?? "";
  assert.ok(persisted);
  assert.doesNotMatch(persisted, /other|participants|lat\":35\.2|sessionId|gpsStatus/);
  const beforeInitialize = api.calls.length;
  const next = new GameClient({ storage, fetch: api.fetcher });
  await next.initialize();
  assert.equal(api.calls.length, beforeInitialize);
  assert.equal(next.snapshot, null);
  assert.equal(next.mode, "virtual", "stored GPS mode does not start a GPS session");
  assert.equal(next.lastMode, "gps");
  assert.equal(next.name, "Walker");
  assert.equal(next.savedRecords.virtual?.region?.id, "virtual-region");
  assert.equal(next.savedRecords.gps?.region?.id, "gps-region");
  assert.equal(next.savedRecords.gps?.totalSteps, 20);
  assert.equal(next.savedRecords.gps?.contribution, 20);
  assert.equal(next.savedRecords.gps?.encounterId, "gps-encounter");
  assert.equal(next.savedRecords.gps?.progress.points, 120);
  assert.equal(next.savedRecords.gps?.progress.equipment.frame, "frame-1");
  assert.deepEqual(next.savedRecords.gps?.history.map((entry) => entry.id), ["own-win"]);
  assert.deepEqual(next.savedRecords.gps?.history[0].personal, []);
  assert.equal(await next.connect("Walker", "gps"), true);
  assert.equal(storage.values.get(idKey), identity);
  assert.equal(next.savedRecords.gps?.region?.id, "gps-region", "browse session retains last target");
  assert.equal(next.savedRecords.gps?.contribution, 20);
  await next.flushLocalRecords();
});

test("browse updates progress and merges bounded own history without erasing the last target", async () => {
  const storage = new MemoryStorage();
  const client = new GameClient({ storage, fetch: server().fetcher });
  assert.equal(await client.connect("Walker", "virtual"), true);
  const internal = client as unknown as { applySnapshot(snapshot: Snapshot, epoch: number): boolean; epoch: number };
  const attacked = snapshot("virtual", "region", 10);
  assert.equal(internal.applySnapshot(attacked, internal.epoch), true);
  const browsing = snapshot("virtual", null, 15);
  browsing.history = [];
  assert.equal(internal.applySnapshot(browsing, internal.epoch), true);
  await client.flushLocalRecords();
  assert.equal(client.savedRecords.virtual?.totalSteps, 15);
  assert.equal(client.savedRecords.virtual?.progress.points, 115);
  assert.equal(client.savedRecords.virtual?.region?.id, "region");
  assert.equal(client.savedRecords.virtual?.contribution, 10);
  assert.equal(client.savedRecords.virtual?.encounterId, "virtual-encounter");
  assert.deepEqual(client.savedRecords.virtual?.history.map((entry) => entry.id), ["own-win"]);
  const changedPlayer = snapshot("virtual", null, 16);
  changedPlayer.player.id = "different-player";
  assert.equal(internal.applySnapshot(changedPlayer, internal.epoch), true);
  assert.equal(client.savedRecords.virtual?.region, null);
  assert.equal(client.savedRecords.virtual?.contribution, 0);
});

test("invalid or mismatched cache is ignored; missing identity can recover a valid cached client id", async () => {
  const storage = new MemoryStorage();
  const api = server();
  const original = new GameClient({ storage, fetch: api.fetcher });
  await original.connect("Walker", "virtual");
  await original.flushLocalRecords();
  const identity = storage.values.get(idKey);
  assert.ok(identity);
  storage.values.delete(idKey);
  const recovered = new GameClient({ storage, fetch: api.fetcher });
  await recovered.initialize();
  assert.equal(await recovered.connect("Walker", "virtual"), true);
  assert.equal(storage.values.get(idKey), identity);
  storage.values.set(idKey, "another-client");
  const mismatch = new GameClient({ storage, fetch: api.fetcher });
  await mismatch.initialize();
  assert.deepEqual(mismatch.savedRecords, {});
  assert.equal(mismatch.lastMode, null);
  storage.values.set(LOCAL_RECORDS_KEY, '{"schema":2,"clientId":"wrong"}');
  const invalid = new GameClient({ storage, fetch: api.fetcher });
  await invalid.initialize();
  assert.deepEqual(invalid.savedRecords, {});
});

test("identity read failure never silently creates another id; record write failure is visible and retryable", async () => {
  const storage = new MemoryStorage();
  const api = server();
  storage.failIdentityRead = true;
  const blocked = new GameClient({ storage, fetch: api.fetcher });
  await blocked.initialize();
  assert.ok(blocked.storageError);
  assert.equal(await blocked.connect("Walker", "virtual"), false);
  assert.equal(storage.values.get(idKey), undefined);
  assert.equal(api.calls.length, 0);
  storage.failIdentityRead = false;
  storage.failRecords = true;
  const client = new GameClient({ storage, fetch: api.fetcher });
  assert.equal(await client.connect("Walker", "virtual"), true);
  await client.flushLocalRecords();
  assert.match(client.storageError ?? "", /저장하지 못했어요/);
  storage.failRecords = false;
  await client.flushLocalRecords();
  assert.equal(client.storageError, null);
  assert.equal(JSON.parse(storage.values.get(LOCAL_RECORDS_KEY) ?? "{}").clientId, storage.values.get(idKey));
});

test("pending writes serialize and flush the latest snapshot; stale epoch cannot alter records", async () => {
  const storage = new MemoryStorage();
  const client = new GameClient({ storage, fetch: server().fetcher });
  await client.connect("Walker", "virtual");
  let release: () => void = () => {};
  storage.gate = new Promise<void>((resolve) => { release = resolve; });
  const internal = client as unknown as { applySnapshot(snapshot: Snapshot, epoch: number): boolean; epoch: number };
  internal.applySnapshot(snapshot("virtual", "region", 1), internal.epoch);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  internal.applySnapshot(snapshot("virtual", "region", 3), internal.epoch);
  internal.applySnapshot(snapshot("virtual", "region", 4), internal.epoch);
  assert.equal(internal.applySnapshot(snapshot("virtual", "stale", 999), internal.epoch - 1), false);
  const flush = client.flushLocalRecords();
  release();
  await flush;
  const persisted = JSON.parse(storage.values.get(LOCAL_RECORDS_KEY) ?? "{}") as {
    records: { virtual: { totalSteps: number; region: { id: string } } };
  };
  assert.equal(persisted.records.virtual.totalSteps, 4);
  assert.equal(persisted.records.virtual.region.id, "region");
  assert.ok(storage.writes.length <= 3, "bursty snapshots coalesce to a bounded number of writes");
});
