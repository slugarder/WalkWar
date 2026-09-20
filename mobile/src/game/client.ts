import type {
  ApiFailure,
  ControlAction,
  GpsSample,
  PlayMode,
  Region,
  Slot,
  Snapshot,
} from "./types.ts";
import {
  LOCAL_RECORDS_KEY,
  parseLocalRecords,
  recordFromSnapshot,
  type LocalPlayerRecord,
} from "./localRecords.ts";
export type { LocalPlayerRecord } from "./localRecords.ts";

export interface GameStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface GameClientOptions {
  storage: GameStorage;
  platform?: string;
  fetch?: typeof globalThis.fetch;
  intervalMs?: number;
  /** Read-only values from the legacy Kotlin SharedPreferences bridge. */
  legacyPreferences?: { server?: string; name?: string; clientId?: string } | null;
}

export interface GameClientView {
  ready: boolean;
  snapshot: Snapshot | null;
  busy: boolean;
  error: string | null;
  serverUrl: string;
  name: string;
  mode: PlayMode;
  savedRecords: Partial<Record<PlayMode, LocalPlayerRecord>>;
  lastMode: PlayMode | null;
  storageError: string | null;
}

type Listener = () => void;
type HttpMethod = "GET" | "POST" | "PUT";
type PendingRetry = () => Promise<void>;
export type GpsProvider = (() => Promise<GpsSample>) | null;
export type GpsTargets = { regions: Region[]; lat: number; lon: number };
type RegionAtResponse = { region: Region | null; ancestors: Region[] };

const SERVER_KEY = "walkwar.server.v1";
const NAME_KEY = "walkwar.name.v1";
const CLIENT_KEY_PREFIX = "walkwar.client.v1:";
const API_BASE = "/api/v1";
export const RAILWAY_SERVER_URL = "https://walkwar-production.up.railway.app";

export function defaultServerUrl(_platform?: string): string {
  return RAILWAY_SERVER_URL;
}

export function normalizeServerUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function playerLocation(
  snapshot: Snapshot | null,
): { lat: number; lng: number } | null {
  if (!snapshot) return null;
  const { lat, lon, xM, yM } = snapshot.player;
  if (lat !== null && lon !== null) return { lat, lng: lon };
  const center = snapshot.region?.center;
  if (!center) return null;
  // The virtual origin is x=60m/y=40m. These approximate meter offsets are
  // intentionally presentation-only; authoritative membership stays server-side.
  const latitude = center.lat + (yM - 40) / 111_320;
  const longitude =
    center.lon + (xM - 60) / (111_320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return { lat: latitude, lng: longitude };
}

class ApiError extends Error {
  readonly retryable: boolean;
  constructor(
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.retryable = retryable;
  }
}

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "서버에 연결하지 못했어요.";
}

/**
 * A bounded client for the WalkWar HTTP contract. It intentionally does not
 * infer a target or produce attack input: only explicit session selection can
 * start a raid.
 */
export class GameClient implements GameClientView {
  ready = false;
  snapshot: Snapshot | null = null;
  busy = false;
  error: string | null = null;
  readonly serverUrl = RAILWAY_SERVER_URL;
  name = "";
  mode: PlayMode = "virtual";
  savedRecords: Partial<Record<PlayMode, LocalPlayerRecord>> = {};
  lastMode: PlayMode | null = null;
  storageError: string | null = null;

  private readonly storage: GameStorage;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly intervalMs: number;
  private readonly legacyPreferences: GameClientOptions["legacyPreferences"];
  private listeners = new Set<Listener>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private timerRunning = false;
  private foreground = true;
  private connected = false;
  private epoch = 0;
  private seq = 0;
  private axisX = 0;
  private axisY = 0;
  private movementEnabled = true;
  private gpsPending: GpsSample | null = null;
  private gpsProvider: GpsProvider = null;
  private serverClockOffsetMs = 0;
  private serverClockKnown = false;
  private lastPollAt = 0;
  private retryWork: PendingRetry | null = null;
  private connectRetry: PendingRetry | null = null;
  private viewRevision = 0;
  private cachedViewRevision = -1;
  private cachedView: GameClientView | null = null;
  private restoredClientId: string | null = null;
  private recordWrite: Promise<boolean> | null = null;
  private pendingRecordValue: string | null = null;
  private persistedRecordValue: string | null = null;
  private recordTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRecordWriteAt = 0;

  constructor(options: GameClientOptions) {
    this.storage = options.storage;
    this.requestFetch = options.fetch ?? globalThis.fetch;
    if (!this.requestFetch) throw new Error("Fetch API를 사용할 수 없습니다.");
    this.intervalMs = options.intervalMs ?? 250;
    this.legacyPreferences = options.legacyPreferences;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private change(): void {
    this.viewRevision++;
    this.notify();
  }

  getView(): GameClientView {
    if (this.cachedViewRevision !== this.viewRevision || !this.cachedView) {
      this.cachedView = {
        ready: this.ready,
        snapshot: this.snapshot,
        busy: this.busy,
        error: this.error,
        serverUrl: this.serverUrl,
        name: this.name,
        mode: this.mode,
        savedRecords: this.savedRecords,
        lastMode: this.lastMode,
        storageError: this.storageError,
      };
      this.cachedViewRevision = this.viewRevision;
    }
    return this.cachedView;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    try {
      // An identity read failure must never be treated like a missing identity.
      const [savedName, identity, rawRecords] = await Promise.all([
        this.storage.getItem(NAME_KEY),
        this.storage.getItem(`${CLIENT_KEY_PREFIX}${this.serverUrl}`),
        this.storage.getItem(LOCAL_RECORDS_KEY),
      ]);
      const cached = parseLocalRecords(rawRecords);
      if (cached && (!identity || cached.clientId === identity)) {
        this.restoredClientId = cached.clientId;
        this.savedRecords = cached.records;
        this.lastMode = cached.lastMode;
        this.persistedRecordValue = rawRecords;
      }
      const recordName = this.lastMode ? this.savedRecords[this.lastMode]?.name : undefined;
      this.name = (savedName || recordName || this.legacyPreferences?.name || "").trim().slice(0, 20);
      await this.storage.setItem(SERVER_KEY, this.serverUrl);
      if (!savedName && this.name)
        await this.storage.setItem(NAME_KEY, this.name);
    } catch {
      this.error = "저장한 연결 설정을 불러오지 못했어요.";
      this.storageError = "저장한 기록과 기기 식별자를 불러오지 못했어요.";
    } finally {
      this.ready = true;
      this.change();
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setForeground(false);
    void this.flushLocalRecords();
  }

  setForeground(active: boolean): void {
    this.foreground = active;
    if (!active) {
      this.epoch++;
      this.stopMoving();
      this.gpsPending = null;
      this.releaseVirtualInput();
    }
    this.change();
  }

  /** Send a zero input after any in-flight directional input has finished. */
  private releaseVirtualInput(): void {
    const sessionId = this.snapshot?.sessionId;
    if (!this.connected || this.mode !== "virtual" || !sessionId) return;
    const playerId = this.snapshot?.player.id;
    if (!playerId) return;
    void this.enqueue(async () => {
      if (
        !this.connected ||
        this.mode !== "virtual" ||
        this.snapshot?.player.id !== playerId ||
        this.snapshot.sessionId !== sessionId
      )
        return;
      await this.request(`players/${encodeURIComponent(playerId)}/input`, "PUT", {
        sessionId,
        seq: ++this.seq,
        axisX: 0,
        axisY: 0,
      });
    }).catch((error) => {
      if (this.connected && this.snapshot?.sessionId === sessionId) {
        this.error = errorMessage(error);
        this.change();
      }
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private apiPath(path: string): string {
    return `${this.serverUrl}${API_BASE}/${path.replace(/^\/+/, "")}`;
  }

  private playerPath(path: string): string {
    if (!this.snapshot?.player.id) throw new ApiError("먼저 서버에 연결해 주세요.", false);
    return `players/${encodeURIComponent(this.snapshot.player.id)}/${path.replace(/^\/+/, "")}`;
  }

  private async request<T>(
    path: string,
    method: HttpMethod = "GET",
    body?: unknown,
  ): Promise<T> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.requestFetch(this.apiPath(path), {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      throw new ApiError(errorMessage(cause), true);
    }
    const text = await response.text();
    const completedAt = Date.now();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON response is treated as an unavailable server, never as data.
    }
    if (!response.ok) {
      const failure = json as ApiFailure | null;
      throw new ApiError(
        failure?.error?.message || `서버 응답 오류 (${response.status})`,
        failure?.error?.retryable ?? response.status >= 500,
      );
    }
    if (!json) throw new ApiError("서버 응답을 읽지 못했어요.", true);
    this.updateServerClock(json, startedAt, completedAt);
    return json as T;
  }

  private updateServerClock(value: unknown, startedAt: number, completedAt: number): void {
    if (completedAt - startedAt < 0 || completedAt - startedAt > 3_000 || !value || typeof value !== "object") return;
    const serverTime = (value as { serverTime?: unknown }).serverTime;
    const parsed = typeof serverTime === "string" ? Date.parse(serverTime) : NaN;
    if (Number.isFinite(parsed)) {
      this.serverClockOffsetMs = parsed - (startedAt + completedAt) / 2;
      this.serverClockKnown = true;
    }
  }

  private deviceTimestampIsFresh(sample: GpsSample, now = Date.now()): boolean {
    return (
      Number.isFinite(sample.capturedAt) &&
      now - sample.capturedAt <= 30_000 &&
      sample.capturedAt - now <= 5_000
    );
  }

  private serverCapturedAt(sample: GpsSample): number {
    return Math.round(sample.capturedAt + this.serverClockOffsetMs);
  }

  private async ensureServerClock(epoch: number, playerId: string, sessionId: string): Promise<void> {
    if (this.serverClockKnown) return;
    const state = await this.request<Snapshot>(`players/${encodeURIComponent(playerId)}/state`);
    if (!this.sameSession(epoch, playerId, sessionId))
      throw new ApiError("현재 위치 확인이 중단됐어요.", false);
    if (!this.serverClockKnown)
      throw new ApiError("서버 시간을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", true);
    this.applySnapshot(state, epoch);
  }

  private applySnapshot(snapshot: Snapshot, epoch: number): boolean {
    if (epoch !== this.epoch || !this.connected) return false;
    const oldSession = this.snapshot?.sessionId;
    this.snapshot = snapshot;
    this.mode = snapshot.player.mode;
    if (oldSession && oldSession !== snapshot.sessionId) {
      this.stopMoving();
      this.gpsPending = null;
      this.seq = 0;
    }
    this.captureLocalRecord(snapshot);
    this.change();
    return true;
  }

  private captureLocalRecord(snapshot: Snapshot): void {
    if (!this.restoredClientId) return;
    const mode = snapshot.player.mode;
    const previous = this.savedRecords[mode];
    const next = recordFromSnapshot(snapshot, previous);
    const changed = !previous || JSON.stringify({ ...previous, savedAt: "" }) !==
      JSON.stringify({ ...next, savedAt: "" });
    if (changed) this.savedRecords = { ...this.savedRecords, [mode]: next };
    const modeChanged = this.lastMode !== mode;
    this.lastMode = mode;
    if (changed || modeChanged) {
      this.scheduleRecordWrite();
      this.change();
    } else if (this.storageError && this.pendingRecordValue) {
      this.armRecordWrite();
    }
  }

  private scheduleRecordWrite(): void {
    if (!this.restoredClientId) return;
    const payload = JSON.stringify({
      schema: 1, clientId: this.restoredClientId, lastMode: this.lastMode,
      records: this.savedRecords,
    });
    if (payload === this.persistedRecordValue && !this.recordWrite) {
      this.pendingRecordValue = null;
      return;
    }
    this.pendingRecordValue = payload;
    this.armRecordWrite();
  }

  private armRecordWrite(): void {
    if (this.recordTimer || this.recordWrite || !this.pendingRecordValue) return;
    const delay = Math.max(0, this.nextRecordWriteAt - Date.now());
    this.recordTimer = setTimeout(() => {
      this.recordTimer = null;
      void this.writeLocalRecords();
    }, delay);
    // Node tests need not wait for the throttle; React Native timers are numeric.
    (this.recordTimer as unknown as { unref?: () => void }).unref?.();
  }

  private writeLocalRecords(): Promise<boolean> {
    if (this.recordWrite) return this.recordWrite;
    if (!this.pendingRecordValue) return Promise.resolve(true);
    const payload = this.pendingRecordValue;
    this.pendingRecordValue = null;
    this.nextRecordWriteAt = Date.now() + 1_000;
    const work = (async () => {
      try {
        await this.storage.setItem(LOCAL_RECORDS_KEY, payload);
        this.persistedRecordValue = payload;
        if (this.storageError) {
          this.storageError = null;
          this.change();
        }
        return true;
      } catch {
        this.pendingRecordValue ??= payload;
        this.storageError = "내 기록을 기기에 저장하지 못했어요. 다시 시도해 주세요.";
        this.change();
        return false;
      }
    })();
    this.recordWrite = work;
    void work.then((succeeded) => {
      this.recordWrite = null;
      if (succeeded) this.armRecordWrite();
    });
    return work;
  }

  /** Persist the latest authoritative record before backgrounding or teardown. */
  async flushLocalRecords(): Promise<void> {
    if (this.recordTimer) clearTimeout(this.recordTimer);
    this.recordTimer = null;
    if (this.recordWrite) await this.recordWrite;
    while (this.pendingRecordValue) {
      if (this.recordTimer) clearTimeout(this.recordTimer);
      this.recordTimer = null;
      if (!await this.writeLocalRecords()) return;
      // The completion callback clears the active write before the next pass.
    }
  }

  private stopMoving(): void {
    this.axisX = 0;
    this.axisY = 0;
  }

  setDirection(x: number, y: number): void {
    if (!this.connected || !this.foreground || !this.movementEnabled) return;
    const length = Math.hypot(x, y);
    this.axisX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.axisY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
    if (length > 1) {
      this.axisX /= length;
      this.axisY /= length;
    }
  }

  setMovementEnabled(enabled: boolean): void {
    this.movementEnabled = enabled;
    if (!enabled) {
      this.stopMoving();
      this.releaseVirtualInput();
    }
  }

  sendGps(sample: GpsSample): void {
    if (!this.connected || !this.foreground || this.mode !== "gps") return;
    if (
      !Number.isFinite(sample.lat) ||
      !Number.isFinite(sample.lon) ||
      !Number.isFinite(sample.accuracyM) ||
      !Number.isFinite(sample.capturedAt) ||
      !Number.isSafeInteger(sample.stepCounter) ||
      !sample.sensorEpoch
    )
      return;
    if (!this.gpsPending || sample.capturedAt >= this.gpsPending.capturedAt)
      this.gpsPending = { ...sample };
  }

  setGpsProvider(provider: GpsProvider): void {
    this.gpsProvider = provider;
  }

  private sameSession(epoch: number, playerId: string, sessionId: string): boolean {
    return (
      epoch === this.epoch &&
      this.foreground &&
      this.connected &&
      this.mode === "gps" &&
      this.snapshot?.player.id === playerId &&
      this.snapshot.sessionId === sessionId
    );
  }

  private async freshGpsForSession(
    epoch: number,
    playerId: string,
    sessionId: string,
  ): Promise<GpsSample> {
    if (!this.sameSession(epoch, playerId, sessionId))
      throw new ApiError("현재 위치 확인이 중단됐어요.", false);
    await this.ensureServerClock(epoch, playerId, sessionId);
    if (!this.sameSession(epoch, playerId, sessionId))
      throw new ApiError("현재 위치 확인이 중단됐어요.", false);
    if (!this.gpsProvider)
      throw new ApiError("현재 위치를 먼저 확인해 주세요.", false);
    let sample: GpsSample;
    try {
      sample = await this.gpsProvider();
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : "현재 위치를 확인하지 못했어요.";
      throw new ApiError(message, true);
    }
    const now = Date.now();
    if (
      !Number.isFinite(sample.lat) ||
      !Number.isFinite(sample.lon) ||
      Math.abs(sample.lat) > 90 ||
      Math.abs(sample.lon) > 180 ||
      !Number.isFinite(sample.accuracyM) ||
      sample.accuracyM < 0 ||
      sample.accuracyM > 50 ||
      !this.deviceTimestampIsFresh(sample, now) ||
      !Number.isSafeInteger(sample.stepCounter) ||
      sample.stepCounter < 0 ||
      !sample.sensorEpoch
    )
      throw new ApiError("GPS 정확도와 측정 시간을 확인해 주세요.", false);
    if (!this.sameSession(epoch, playerId, sessionId))
      throw new ApiError("현재 위치 확인이 중단됐어요.", false);
    const fresh = await this.request<Snapshot>(`players/${encodeURIComponent(playerId)}/gps`, "POST", {
      ...sample,
      capturedAt: this.serverCapturedAt(sample),
      sessionId,
      seq: ++this.seq,
    });
    if (!this.sameSession(epoch, playerId, sessionId))
      throw new ApiError("현재 위치 확인이 중단됐어요.", false);
    if (
      this.gpsPending &&
      this.gpsPending.sensorEpoch === sample.sensorEpoch &&
      this.gpsPending.capturedAt <= sample.capturedAt &&
      this.gpsPending.stepCounter <= sample.stepCounter
    )
      this.gpsPending = null;
    this.applySnapshot(fresh, epoch);
    return sample;
  }

  private async tick(): Promise<void> {
    if (this.timerRunning || this.busy || !this.foreground || !this.connected) return;
    this.timerRunning = true;
    const epoch = this.epoch;
    try {
      await this.enqueue(async () => {
        if (epoch !== this.epoch || this.busy || !this.foreground || !this.connected) return;
        const sessionId = this.snapshot?.sessionId;
        if (!sessionId) return;
        if (this.mode === "virtual") {
          await this.request(this.playerPath("input"), "PUT", {
            sessionId,
            seq: ++this.seq,
            axisX: this.movementEnabled ? this.axisX : 0,
            axisY: this.movementEnabled ? this.axisY : 0,
          });
        } else if (Date.now() - this.lastPollAt >= 1_000) {
          await this.request(this.playerPath("heartbeat"), "POST", { sessionId });
          const pending = this.gpsPending;
          if (pending && !this.deviceTimestampIsFresh(pending)) this.gpsPending = null;
          if (pending && this.serverClockKnown && this.deviceTimestampIsFresh(pending)) {
            this.gpsPending = null;
            const fresh = await this.request<Snapshot>(this.playerPath("gps"), "POST", {
              ...pending,
              capturedAt: this.serverCapturedAt(pending),
              sessionId,
              seq: ++this.seq,
            });
            this.applySnapshot(fresh, epoch);
          }
        }
        if (Date.now() - this.lastPollAt >= 1_000) {
          const fresh = await this.request<Snapshot>(this.playerPath("state"));
          this.lastPollAt = Date.now();
          this.applySnapshot(fresh, epoch);
        }
      });
    } catch (error) {
      if (epoch === this.epoch) {
        this.error = errorMessage(error);
        this.stopMoving();
        this.change();
      }
    } finally {
      this.timerRunning = false;
    }
  }

  private async saveConfiguration(): Promise<void> {
    await Promise.all([
      this.storage.setItem(SERVER_KEY, this.serverUrl),
      this.storage.setItem(NAME_KEY, this.name),
    ]);
  }

  private async clientId(): Promise<string> {
    const key = `${CLIENT_KEY_PREFIX}${this.serverUrl}`;
    const existing = await this.storage.getItem(key);
    if (existing) {
      this.restoredClientId = existing;
      return existing;
    }
    const legacyServer = normalizeServerUrl(this.legacyPreferences?.server ?? "");
    const created =
      this.restoredClientId ?? (legacyServer === this.serverUrl && this.legacyPreferences?.clientId
        ? this.legacyPreferences.clientId
        : requestId());
    await this.storage.setItem(key, created);
    this.restoredClientId = created;
    return created;
  }

  async connect(name: string, mode: PlayMode): Promise<boolean> {
    await this.initialize();
    const displayName = name.trim().slice(0, 20);
    if (!displayName) {
      this.error = "이름을 입력해 주세요.";
      this.change();
      return false;
    }
    this.name = displayName;
    this.connected = false;
    this.snapshot = null;
    this.mode = mode;
    this.stopMoving();
    this.gpsPending = null;
    this.seq = 0;
    this.epoch++;
    const epoch = this.epoch;
    const sessionBody = { requestId: requestId(), mode };
    const completeSession = async (playerId: string): Promise<void> => {
      const fresh = await this.request<Snapshot>(`players/${encodeURIComponent(playerId)}/session`, "POST", sessionBody);
      if (epoch !== this.epoch) return;
      this.connected = true;
      this.snapshot = fresh;
      this.mode = fresh.player.mode;
      this.lastPollAt = 0;
      this.retryWork = null;
      this.captureLocalRecord(fresh);
      this.change();
    };
    const connectWork = async () => {
      try {
        await this.saveConfiguration();
      } catch {
        // Connecting still works when local persistence is temporarily unavailable.
      }
      const joined = await this.request<Snapshot>("players", "POST", {
        clientId: await this.clientId(),
        displayName,
      });
      if (epoch !== this.epoch) return;
      this.snapshot = joined;
      await completeSession(joined.player.id);
    };
    return this.runBusy(connectWork, async () => {
      const playerId = this.snapshot?.player.id;
      if (playerId) await completeSession(playerId);
      else await connectWork();
    });
  }

  disconnect(): void {
    this.epoch++;
    this.connected = false;
    this.snapshot = null;
    this.mode = "virtual";
    this.stopMoving();
    this.gpsPending = null;
    this.seq = 0;
    this.retryWork = null;
    this.connectRetry = null;
    this.change();
  }

  private async runBusy(work: () => Promise<void>, retry?: PendingRetry): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.change();
    try {
      await this.enqueue(work);
      this.retryWork = null;
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      this.retryWork = retry ?? work;
      this.stopMoving();
      return false;
    } finally {
      this.busy = false;
      this.change();
    }
  }

  async selectRegion(id: string): Promise<boolean> {
    if (this.busy || !this.connected || !id || !this.snapshot?.sessionId) return false;
    const epoch = ++this.epoch;
    const playerId = this.snapshot.player.id;
    const sessionId = this.snapshot.sessionId;
    const selectedMode = this.mode;
    this.stopMoving();
    const body = { requestId: requestId(), mode: selectedMode, regionId: id };
    const work = async () => {
      if (selectedMode === "gps")
        await this.freshGpsForSession(epoch, playerId, sessionId);
      if (
        epoch !== this.epoch ||
        !this.connected ||
        this.snapshot?.player.id !== playerId ||
        this.snapshot.sessionId !== sessionId
      )
        throw new ApiError("공략 시작이 중단됐어요.", false);
      const fresh = await this.request<Snapshot>(this.playerPath("session"), "POST", body);
      this.applySnapshot(fresh, epoch);
    };
    const sameSelectionContext = () => selectedMode === "gps"
      ? this.sameSession(epoch, playerId, sessionId)
      : (
        epoch === this.epoch &&
        this.connected &&
        this.mode === selectedMode &&
        this.snapshot?.player.id === playerId &&
        this.snapshot.sessionId === sessionId
      );
    const retry = async () => {
      if (!sameSelectionContext())
        throw new ApiError("공략 시작이 중단됐어요.", false);
      const state = await this.request<Snapshot>(`players/${encodeURIComponent(playerId)}/state`);
      if (!sameSelectionContext())
        throw new ApiError("공략 시작이 중단됐어요.", false);
      if (state.sessionId !== sessionId) {
        if (state.player.mode !== selectedMode || state.player.regionId !== id)
          throw new ApiError("공략 대상이 변경되어 다시 선택해 주세요.", false);
        const replayed = await this.request<Snapshot>(`players/${encodeURIComponent(playerId)}/session`, "POST", body);
        this.applySnapshot(replayed, epoch);
        return;
      }
      await work();
    };
    return this.runBusy(work, retry);
  }

  async findGpsTargets(): Promise<GpsTargets | null> {
    if (this.busy || !this.connected || this.mode !== "gps" || !this.snapshot?.sessionId)
      return null;
    const epoch = ++this.epoch;
    const playerId = this.snapshot.player.id;
    const sessionId = this.snapshot.sessionId;
    let result: GpsTargets | null = null;
    const work = async () => {
      const sample = await this.freshGpsForSession(epoch, playerId, sessionId);
      if (!this.sameSession(epoch, playerId, sessionId)) return;
      const query = new URLSearchParams({
        lat: String(sample.lat),
        lon: String(sample.lon),
        mode: "gps",
      });
      const found = await this.request<RegionAtResponse>(`map/region-at?${query}`);
      if (!this.sameSession(epoch, playerId, sessionId)) return;
      if (!found.region)
        throw new ApiError("현재 위치의 행정구역을 찾지 못했어요.", false);
      const ids = new Set<string>();
      const regions = [...found.ancestors, found.region].filter((region) => {
        if (ids.has(region.id)) return false;
        ids.add(region.id);
        return true;
      });
      result = { regions, lat: sample.lat, lon: sample.lon };
    };
    const succeeded = await this.runBusy(work, work);
    return succeeded ? result : null;
  }

  private mutate(
    path: "control" | "purchases" | "equipment",
    method: "POST" | "PUT",
    body: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.connected || !this.snapshot?.sessionId) return Promise.resolve(false);
    const epoch = ++this.epoch;
    const requestBody = {
      ...body,
      sessionId: this.snapshot.sessionId,
      requestId: requestId(),
    };
    const work = async () => {
      const fresh = await this.request<Snapshot>(this.playerPath(path), method, requestBody);
      this.applySnapshot(fresh, epoch);
    };
    return this.runBusy(work, work);
  }

  purchase(itemId: string): Promise<boolean> {
    return this.mutate("purchases", "POST", { itemId });
  }

  equip(slot: Slot, itemId: string | null): Promise<boolean> {
    return this.mutate("equipment", "PUT", { slot, itemId });
  }

  control(action: ControlAction): Promise<boolean> {
    return this.mutate("control", "POST", { action });
  }

  async read<T>(path: string): Promise<T> {
    return this.enqueue(() => this.request<T>(path));
  }

  async retry(): Promise<void> {
    const retry = this.retryWork ?? this.connectRetry;
    if (!retry) return;
    await this.runBusy(retry, retry);
  }

  dismissError(): void {
    this.error = null;
    this.change();
  }
}
