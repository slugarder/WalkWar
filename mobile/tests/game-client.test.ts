import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultServerUrl,
  GameClient,
  normalizeServerUrl,
  playerLocation,
  RAILWAY_SERVER_URL,
  type GameStorage,
} from "../src/game/client.ts";
import type { GpsSample, Snapshot } from "../src/game/types.ts";

class MemoryStorage implements GameStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function snapshot(
  mode: "virtual" | "gps",
  sessionId: string,
  regionId: string | null = null,
  serverTime = new Date().toISOString(),
): Snapshot {
  return {
    player: { id: "player-1", name: "Walker", mode, totalSteps: 0, regionId, xM: 60, yM: 40, lat: null, lon: null },
    sessionId,
    worldVersion: 1,
    serverTime,
    region: regionId
      ? { id: regionId, code: "1", codeSystem: "test", name: "부산", fullName: "부산", level: "emd", parentId: null, center: { lat: 35.1, lon: 129.0 } }
      : null,
    regionPath: [],
    raid: null,
    participants: [],
    progress: { points: 0, badges: [], ownedItems: [], earnedTitles: [], equipment: { frame: null, badge: null, nameplate: null, title: null }, wins: 0, distinctRegions: 0 },
    catalog: { items: [], titles: [] },
    history: [],
    gpsStatus: null,
    dataInfo: { date: "2026-07-01", source: "test", regionCount: 1 },
  };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function failure(message: string): Response {
  return new Response(JSON.stringify({ error: { code: "GPS_NOT_READY", message, retryable: false } }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
}

function freshGps(overrides: Partial<GpsSample> = {}): GpsSample {
  return {
    lat: 37.5665,
    lon: 126.978,
    accuracyM: 10,
    capturedAt: Date.now(),
    stepCounter: 100,
    sensorEpoch: "sensor-a",
    ...overrides,
  };
}

async function connectGps(client: GameClient): Promise<void> {
  assert.equal(await client.connect("Walker", "gps"), true);
  assert.equal(client.mode, "gps");
  assert.equal(client.snapshot?.sessionId, "gps-browse");
}

test("always uses the fixed Railway server while retaining URL validation for legacy migration", () => {
  const previous = process.env.EXPO_PUBLIC_GAME_SERVER_URL;
  try {
    delete process.env.EXPO_PUBLIC_GAME_SERVER_URL;
    assert.equal(defaultServerUrl("android"), RAILWAY_SERVER_URL);
    assert.equal(defaultServerUrl("web"), RAILWAY_SERVER_URL);
    process.env.EXPO_PUBLIC_GAME_SERVER_URL = "https://game.example:3040/";
    assert.equal(defaultServerUrl("android"), RAILWAY_SERVER_URL);
    process.env.EXPO_PUBLIC_GAME_SERVER_URL = "https://game.example/api/v1";
    assert.equal(defaultServerUrl("web"), RAILWAY_SERVER_URL);
    assert.equal(normalizeServerUrl("https://game.example:3040/"), "https://game.example:3040");
    assert.equal(normalizeServerUrl("https://game.example/api/v1"), null);
    assert.equal(normalizeServerUrl("ftp://game.example"), null);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_GAME_SERVER_URL;
    else process.env.EXPO_PUBLIC_GAME_SERVER_URL = previous;
  }
});

test("fixed Railway origin ignores stored and legacy servers while preserving the name and Railway client id", async () => {
  const previous = process.env.EXPO_PUBLIC_GAME_SERVER_URL;
  process.env.EXPO_PUBLIC_GAME_SERVER_URL = "https://env-override.example";
  try {
  const storage = new MemoryStorage();
  storage.values.set("walkwar.server.v1", "http://127.0.0.1:3040");
  storage.values.set("walkwar.name.v1", " Remembered ");
  storage.values.set(`walkwar.client.v1:${RAILWAY_SERVER_URL}`, "existing-railway-client");
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const client = new GameClient({
    storage,
    platform: "web",
    legacyPreferences: { server: "https://legacy.example", name: "Legacy name", clientId: "legacy-client" },
    fetch: async (url, init) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/players")) return response(snapshot("virtual", ""));
      return response(snapshot("virtual", "session-browse"));
    },
  });
  await client.initialize();
  assert.equal(client.serverUrl, RAILWAY_SERVER_URL);
  assert.equal(client.name, "Remembered");
  assert.equal(storage.values.get("walkwar.server.v1"), RAILWAY_SERVER_URL);
  assert.equal(await client.connect(client.name, "virtual"), true);
  assert.equal(client.snapshot?.sessionId, "session-browse");
  assert.ok(calls.every((call) => call.url.startsWith(`${RAILWAY_SERVER_URL}/api/v1/`)));
  assert.equal(calls[0].body?.clientId, "existing-railway-client");
  assert.deepEqual(calls[1].body, { requestId: calls[1].body?.requestId, mode: "virtual" });
  assert.equal("regionId" in (calls[1].body ?? {}), false);
  assert.equal(storage.values.get(`walkwar.client.v1:${RAILWAY_SERVER_URL}`), "existing-railway-client");
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_GAME_SERVER_URL;
    else process.env.EXPO_PUBLIC_GAME_SERVER_URL = previous;
  }
});

test("an in-flight old poll cannot replace an explicit region selection", async () => {
  const storage = new MemoryStorage();
  let releaseState: (() => void) | undefined;
  let stateStarted: (() => void) | undefined;
  const stateGate = new Promise<void>((resolve) => (releaseState = resolve));
  const stateSeen = new Promise<void>((resolve) => (stateStarted = resolve));
  const client = new GameClient({
    storage,
    intervalMs: 60_000,
    fetch: async (url, init) => {
      const path = String(url);
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/session")) {
        const body = JSON.parse(String(init?.body)) as { regionId?: string };
        return response(snapshot("virtual", body.regionId ? "session-new" : "session-browse", body.regionId ?? null));
      }
      if (path.endsWith("/input")) return response({ accepted: true, lastSeq: 1 });
      if (path.endsWith("/state")) {
        stateStarted?.();
        await stateGate;
        return response(snapshot("virtual", "session-browse"));
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  await client.connect("Walker", "virtual");
  const internal = client as unknown as { tick(): Promise<void> };
  const poll = internal.tick();
  await stateSeen;
  const selection = client.selectRegion("region-2");
  releaseState?.();
  await poll;
  assert.equal(await selection, true);
  assert.equal(client.snapshot?.player.regionId, "region-2");
  assert.equal(client.snapshot?.sessionId, "session-new");
});

test("a failed idempotent purchase retries the same body", async () => {
  const storage = new MemoryStorage();
  const purchaseBodies: Record<string, unknown>[] = [];
  let purchaseAttempts = 0;
  const client = new GameClient({
    storage,
    fetch: async (url, init) => {
      const path = String(url);
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/session")) return response(snapshot("virtual", "session-browse"));
      if (path.endsWith("/purchases")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        purchaseBodies.push(body);
        if (purchaseAttempts++ === 0) throw new Error("temporary network failure");
        return response(snapshot("virtual", "session-browse"));
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  await client.connect("Walker", "virtual");
  assert.equal(await client.purchase("cafe-postcard"), false);
  await client.retry();
  assert.deepEqual(purchaseBodies[1], purchaseBodies[0]);
});

test("GPS selection pushes a fresh current-session reading before session and retries with monotonic sequence", async () => {
  const gpsBodies: Record<string, unknown>[] = [];
  const targetSessions: Record<string, unknown>[] = [];
  const order: string[] = [];
  let targetAttempts = 0;
  let providerCalls = 0;
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/gps")) {
        order.push("gps");
        gpsBodies.push(body);
        return response(snapshot("gps", "gps-browse"));
      }
      if (path.endsWith("/state")) return response(snapshot("gps", "gps-browse"));
      if (path.endsWith("/session")) {
        if (!body.regionId) return response(snapshot("gps", "gps-browse"));
        order.push("session");
        targetSessions.push(body);
        if (targetAttempts++ === 0) return failure("정확한 현재 위치를 확인한 뒤 공략을 시작해 주세요.");
        return response(snapshot("gps", "gps-target", String(body.regionId)));
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  await connectGps(client);
  client.setGpsProvider(async () => freshGps({ stepCounter: 100 + ++providerCalls }));
  assert.equal(await client.selectRegion("target"), false);
  assert.equal(client.snapshot?.sessionId, "gps-browse", "failed selection must retain the current session");
  await client.retry();
  assert.deepEqual(gpsBodies.map((body) => body.seq), [1, 2]);
  assert.deepEqual(order, ["gps", "session", "gps", "session"]);
  assert.equal(targetSessions[1].requestId, targetSessions[0].requestId, "retry keeps the session receipt id");
  assert.equal(client.snapshot?.sessionId, "gps-target");
  assert.equal(client.snapshot?.player.regionId, "target");
});

test("GPS selection recovers a lost committed session response by replaying its receipt without another GPS push", async () => {
  const gpsBodies: Record<string, unknown>[] = [];
  const targetSessions: Record<string, unknown>[] = [];
  let targetCalls = 0;
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/gps")) {
        gpsBodies.push(body);
        return response(snapshot("gps", "gps-browse"));
      }
      if (path.endsWith("/state")) return response(snapshot("gps", "gps-target", "target"));
      if (path.endsWith("/session")) {
        if (!body.regionId) return response(snapshot("gps", "gps-browse"));
        targetSessions.push(body);
        if (targetCalls++ === 0) throw new Error("response lost after commit");
        return response(snapshot("gps", "gps-target", "target"));
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  await connectGps(client);
  client.setGpsProvider(async () => freshGps());
  assert.equal(await client.selectRegion("target"), false);
  await client.retry();
  assert.equal(gpsBodies.length, 1, "recovery must not send GPS to the old session");
  assert.equal(targetSessions.length, 2, "the original idempotency receipt is replayed once");
  assert.equal(targetSessions[1].requestId, targetSessions[0].requestId);
  assert.equal(client.snapshot?.sessionId, "gps-target");
});

test("GPS selection aborts stale or inaccurate provider readings before either mutation", async () => {
  let gpsCalls = 0;
  let targetSessionCalls = 0;
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/session")) {
        if (body.regionId) targetSessionCalls++;
        return response(snapshot("gps", "gps-browse"));
      }
      if (path.endsWith("/gps")) gpsCalls++;
      return response(snapshot("gps", "gps-browse"));
    },
  });
  await connectGps(client);
  client.setGpsProvider(async () => freshGps({ accuracyM: 51 }));
  assert.equal(await client.selectRegion("target"), false);
  client.dismissError();
  client.setGpsProvider(async () => freshGps({ capturedAt: Date.now() - 30_001 }));
  assert.equal(await client.selectRegion("target"), false);
  assert.equal(gpsCalls, 0);
  assert.equal(targetSessionCalls, 0);
  assert.match(client.error ?? "", /GPS 정확도와 측정 시간/);
});

test("uses a recent authoritative server clock for both explicit and queued GPS timestamps", async () => {
  for (const offset of [-10_000, 60_000]) {
    const clock = () => new Date(Date.now() + offset).toISOString();
    const explicitBodies: Record<string, unknown>[] = [];
    const explicit = new GameClient({
      storage: new MemoryStorage(),
      fetch: async (url, init) => {
        const path = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        if (path.endsWith("/players")) return response(snapshot("virtual", "", null, clock()));
        if (path.endsWith("/session")) {
          if (!body.regionId) return response(snapshot("gps", "gps-browse", null, clock()));
          return response(snapshot("gps", "gps-target", String(body.regionId), clock()));
        }
        if (path.endsWith("/gps")) {
          explicitBodies.push(body);
          return response(snapshot("gps", "gps-browse", null, clock()));
        }
        throw new Error(`unexpected ${path}`);
      },
    });
    await connectGps(explicit);
    const capturedAt = Date.now();
    explicit.setGpsProvider(async () => freshGps({ capturedAt }));
    assert.equal(await explicit.selectRegion("target"), true);
    assert.ok(Math.abs(Number(explicitBodies[0].capturedAt) - (capturedAt + offset)) < 500);

    const queuedBodies: Record<string, unknown>[] = [];
    const queued = new GameClient({
      storage: new MemoryStorage(),
      intervalMs: 60_000,
      fetch: async (url, init) => {
        const path = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        if (path.endsWith("/players")) return response(snapshot("virtual", "", null, clock()));
        if (path.endsWith("/session")) return response(snapshot("gps", "gps-browse", null, clock()));
        if (path.endsWith("/heartbeat")) return response({ ok: true });
        if (path.endsWith("/gps")) {
          queuedBodies.push(body);
          return response(snapshot("gps", "gps-browse", null, clock()));
        }
        if (path.endsWith("/state")) return response(snapshot("gps", "gps-browse", null, clock()));
        throw new Error(`unexpected ${path}`);
      },
    });
    await connectGps(queued);
    const queuedCapturedAt = Date.now();
    queued.sendGps(freshGps({ capturedAt: queuedCapturedAt }));
    await (queued as unknown as { tick(): Promise<void> }).tick();
    assert.ok(Math.abs(Number(queuedBodies[0].capturedAt) - (queuedCapturedAt + offset)) < 500);
  }
});

test("clock correction does not make stale or future device readings fresh", async () => {
  const gpsBodies: Record<string, unknown>[] = [];
  const client = new GameClient({
    storage: new MemoryStorage(),
    intervalMs: 60_000,
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const serverTime = new Date(Date.now() - 10_000).toISOString();
      if (path.endsWith("/players")) return response(snapshot("virtual", "", null, serverTime));
      if (path.endsWith("/session")) return response(snapshot("gps", "gps-browse", null, serverTime));
      if (path.endsWith("/heartbeat")) return response({ ok: true });
      if (path.endsWith("/gps")) gpsBodies.push(body);
      if (path.endsWith("/state")) return response(snapshot("gps", "gps-browse", null, serverTime));
      return response(snapshot("gps", "gps-browse", null, serverTime));
    },
  });
  await connectGps(client);
  client.sendGps(freshGps({ capturedAt: Date.now() - 30_001 }));
  await (client as unknown as { tick(): Promise<void> }).tick();
  client.sendGps(freshGps({ capturedAt: Date.now() + 5_001 }));
  await (client as unknown as { tick(): Promise<void> }).tick();
  assert.equal(gpsBodies.length, 0);
});

test("GPS target discovery pushes a reading, returns the full parent-first hierarchy, and does not select a raid", async () => {
  const sessions: Record<string, unknown>[] = [];
  let gpsCalls = 0;
  const city = { id: "city", code: "1", codeSystem: "test", name: "수원시", fullName: "경기도 수원시", level: "sigungu" as const, parentId: "province", center: null, isAggregateCity: true, mapSelectable: false };
  const province = { id: "province", code: "2", codeSystem: "test", name: "경기도", fullName: "경기도", level: "sido" as const, parentId: null, center: null };
  const emd = { id: "emd", code: "3", codeSystem: "test", name: "영통동", fullName: "경기도 수원시 영통동", level: "emd" as const, parentId: "city", center: { lat: 37.25, lon: 127.07 } };
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/session")) {
        sessions.push(body);
        return response(snapshot("gps", "gps-browse"));
      }
      if (path.endsWith("/gps")) {
        gpsCalls++;
        return response(snapshot("gps", "gps-browse"));
      }
      if (path.includes("/map/region-at?")) {
        assert.match(path, /mode=gps/);
        return response({ region: emd, ancestors: [province, city, city] });
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  await connectGps(client);
  client.setGpsProvider(async () => freshGps({ lat: 37.25, lon: 127.07 }));
  const targets = await client.findGpsTargets();
  assert.equal(gpsCalls, 1);
  assert.deepEqual(targets?.regions.map((region) => region.id), ["province", "city", "emd"]);
  assert.equal(targets?.regions[1].mapSelectable, false, "aggregate parent remains available to the UI");
  assert.equal(sessions.length, 1, "discovery must not create a target session");
  assert.equal(client.snapshot?.raid, null);
  assert.equal(client.snapshot?.player.regionId, null);
});

test("GPS target discovery reports an unresolved administrative boundary without selecting a session", async () => {
  let sessionCalls = 0;
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/session")) {
        sessionCalls++;
        return response(snapshot("gps", "gps-browse"));
      }
      if (path.endsWith("/gps")) return response(snapshot("gps", "gps-browse"));
      if (path.includes("/map/region-at?")) return response({ region: null, ancestors: [] });
      throw new Error(`unexpected ${path}`);
    },
  });
  await connectGps(client);
  client.setGpsProvider(async () => freshGps());
  assert.equal(await client.findGpsTargets(), null);
  assert.match(client.error ?? "", /행정구역/);
  assert.equal(sessionCalls, 1, "boundary lookup must not create a target session");
  assert.equal(client.snapshot?.raid, null);
});

test("virtual selection does not require or invoke a GPS provider", async () => {
  let gpsCalls = 0;
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/gps")) gpsCalls++;
      if (path.endsWith("/session"))
        return response(snapshot("virtual", body.regionId ? "virtual-target" : "virtual-browse", String(body.regionId ?? "") || null));
      throw new Error(`unexpected ${path}`);
    },
  });
  assert.equal(await client.connect("Walker", "virtual"), true);
  client.setGpsProvider(async () => {
    throw new Error("virtual mode must not query GPS");
  });
  assert.equal(await client.selectRegion("virtual-target"), true);
  assert.equal(gpsCalls, 0);
  assert.equal(client.snapshot?.player.regionId, "virtual-target");
});

test("virtual selection also replays a lost committed session response without GPS", async () => {
  let targetCalls = 0;
  let gpsCalls = 0;
  const client = new GameClient({
    storage: new MemoryStorage(),
    fetch: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith("/players")) return response(snapshot("virtual", ""));
      if (path.endsWith("/state")) return response(snapshot("virtual", "virtual-target", "target"));
      if (path.endsWith("/gps")) gpsCalls++;
      if (path.endsWith("/session")) {
        if (!body.regionId) return response(snapshot("virtual", "virtual-browse"));
        if (targetCalls++ === 0) throw new Error("response lost after commit");
        return response(snapshot("virtual", "virtual-target", "target"));
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  assert.equal(await client.connect("Walker", "virtual"), true);
  assert.equal(await client.selectRegion("target"), false);
  await client.retry();
  assert.equal(client.snapshot?.sessionId, "virtual-target");
  assert.equal(gpsCalls, 0);
});

test("location favors verified GPS and otherwise offsets virtual coordinates from the selected center", () => {
  const virtual = snapshot("virtual", "session", "region");
  virtual.player.xM = 60 + 111_320 * Math.cos((35.1 * Math.PI) / 180);
  virtual.player.yM = 40 + 111_320;
  assert.deepEqual(playerLocation(virtual), { lat: 36.1, lng: 130 });
  virtual.player.lat = 35.2;
  virtual.player.lon = 129.2;
  assert.deepEqual(playerLocation(virtual), { lat: 35.2, lng: 129.2 });
});
