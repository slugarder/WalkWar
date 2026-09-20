import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/device/GpsTracker.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness(initial = 'granted', pedometerAvailable = false) {
  let listener: (state: string) => void = () => {};
  let locationStatus = initial;
  let permissionResolve: (() => void) | undefined;
  const cleanups: Array<() => void> = [];
  const counts = { locationPrompt: 0, pedometerPrompt: 0, watching: 0, removed: 0 };
  const states: any[] = [];
  const samples: any[] = [];
  let currentLocation = { coords: { latitude: 35.1, longitude: 129.1, accuracy: 5 }, timestamp: Date.now() };
  let delayedCurrent = false;
  let resolveCurrent: (() => void) | undefined;
  let watchCallback: ((location: typeof currentLocation) => void) | undefined;
  let stepCallback: ((update: { steps: number }) => void) | undefined;
  const appState = { currentState: 'active', addEventListener: (_: string, callback: (state: string) => void) => {
    listener = callback; return { remove() {} };
  } };
  const permission = () => ({ status: locationStatus, canAskAgain: true });
  const location = {
    Accuracy: { BestForNavigation: 6 },
    getForegroundPermissionsAsync: async () => permission(),
    requestForegroundPermissionsAsync: async () => {
      counts.locationPrompt++;
      await new Promise<void>(resolve => { permissionResolve = resolve; });
      return permission();
    },
    hasServicesEnabledAsync: async () => true,
    getCurrentPositionAsync: async () => {
      if (delayedCurrent) await new Promise<void>(resolve => { resolveCurrent = resolve; });
      return currentLocation;
    },
    watchPositionAsync: async (_options: unknown, callback: typeof watchCallback) => { counts.watching++; watchCallback = callback; return { remove() { counts.removed++; } }; },
  };
  const react = {
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => {
      let current = value as any;
      return [current, (next: any) => { current = typeof next === 'function' ? next(current) : next; states.push(current); }];
    },
    useCallback: (callback: any) => callback,
    useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
  };
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'react') return react;
    if (name === 'react-native') return { AppState: appState, Platform: { OS: 'android' } };
    if (name === 'expo-location') return location;
    if (name === 'expo-sensors') return { Pedometer: {
      getPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
      requestPermissionsAsync: async () => { counts.pedometerPrompt++; return { status: 'granted' }; },
      isAvailableAsync: async () => pedometerAvailable,
      watchStepCount: (callback: (update: { steps: number }) => void) => {
        stepCallback = callback;
        return { remove() {} };
      },
    } };
    if (name === './diagnostics') return { recordDiagnostic() {} };
    throw new Error(name);
  }, exports);
  const tracker = exports.useGpsTracker(true, 'session-one', (sample: any) => samples.push(sample));
  return {
    counts, states,
    transition(state: string) { appState.currentState = state; listener(state); },
    resolvePermission(status: string) { locationStatus = status; permissionResolve?.(); },
    setLocation(location: typeof currentLocation) { currentLocation = location; },
    delayCurrent() { delayedCurrent = true; },
    resolveCurrent() { delayedCurrent = false; resolveCurrent?.(); },
    sendLocation(location: typeof currentLocation) { watchCallback?.(location); },
    sendSteps(steps: number) { stepCallback?.({ steps }); },
    samples,
    refresh() { return tracker.refresh(); },
    dispose() { cleanups.forEach(cleanup => cleanup()); },
  };
}

test('already-granted GPS and motion permissions never open a prompt on foreground resume', async () => {
  const h = harness(); await flush();
  assert.equal(h.counts.watching, 1);
  h.transition('background'); h.transition('active'); await flush();
  assert.equal(h.counts.watching, 2);
  assert.equal(h.counts.removed, 1);
  assert.equal(h.counts.locationPrompt, 0);
  assert.equal(h.counts.pedometerPrompt, 0);
  h.dispose();
});

test('Android permission background/resume settles to tracking without a permission restart loop', async () => {
  const h = harness('undetermined'); await flush();
  h.transition('background'); h.transition('active');
  h.resolvePermission('granted'); await flush();
  assert.equal(h.counts.locationPrompt, 1);
  assert.equal(h.counts.watching, 1);
  assert.equal(h.states.at(-1)?.status, 'GPS 추적 중 (걸음 센서 사용 불가)');
  await flush();
  assert.equal(h.counts.watching, 1);
  h.dispose();
});

test('Home during a permission prompt cannot start background GPS after the permission resolves', async () => {
  const h = harness('undetermined'); await flush();
  h.transition('background'); h.resolvePermission('granted'); await flush();
  assert.equal(h.counts.watching, 0);
  h.transition('active'); await flush();
  assert.equal(h.counts.watching, 1);
  assert.equal(h.counts.locationPrompt, 1);
  h.dispose();
});

test('denied permission is not prompted repeatedly by app-state changes', async () => {
  const h = harness('undetermined'); await flush();
  h.resolvePermission('denied'); await flush();
  for (let i = 0; i < 3; i++) { h.transition('background'); h.transition('active'); await flush(); }
  assert.equal(h.counts.locationPrompt, 1);
  assert.equal(h.counts.watching, 0);
  h.dispose();
});

test('refresh returns the original timestamp and finite bounded accuracy', async () => {
  const h = harness(); await flush();
  const location = { coords: { latitude: 35.2, longitude: 129.2, accuracy: 8 }, timestamp: Date.now() - 1000 };
  h.setLocation(location);
  const sample = await h.refresh();
  assert.equal(sample.capturedAt, location.timestamp);
  assert.equal(sample.accuracyM, 8);
  h.dispose();
});

test('refresh rejects stale and unknown-accuracy locations', async () => {
  const h = harness(); await flush();
  h.setLocation({ coords: { latitude: 35.2, longitude: 129.2, accuracy: 8 }, timestamp: Date.now() - 31_000 });
  await assert.rejects(h.refresh(), /오래된 위치/);
  h.setLocation({ coords: { latitude: 35.2, longitude: 129.2, accuracy: null as unknown as number }, timestamp: Date.now() });
  await assert.rejects(h.refresh(), /정확한 위치/);
  h.dispose();
});

test('refresh is cancelled while the app is backgrounded', async () => {
  const h = harness(); await flush();
  h.transition('background');
  await assert.rejects(h.refresh(), /위치 추적/);
  h.dispose();
});

test('concurrent refresh calls share one native current-position request', async () => {
  const h = harness(); await flush();
  h.delayCurrent();
  const first = h.refresh();
  const second = h.refresh();
  h.resolveCurrent();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(h.samples.length, 1);
  h.dispose();
});

test('late refresh completion after unmount emits nothing', async () => {
  const h = harness(); await flush();
  h.delayCurrent();
  const pending = h.refresh();
  h.dispose();
  h.resolveCurrent();
  await assert.rejects(pending, /중지되었어요|사용할 수 없어요/);
  assert.equal(h.samples.length, 0);
});

test('watcher forwards known inaccurate accuracy and uses a nonzero sentinel when unknown', async () => {
  const h = harness(); await flush();
  const timestamp = Date.now();
  h.sendLocation({ coords: { latitude: 35.2, longitude: 129.2, accuracy: 75 }, timestamp });
  assert.equal(h.samples.at(-1)?.accuracyM, 75);
  h.sendLocation({ coords: { latitude: 35.2, longitude: 129.2, accuracy: null as unknown as number }, timestamp });
  assert.equal(h.samples.at(-1)?.accuracyM, 1_000_000_000);
  h.dispose();
});

test('pedometer observables count real callbacks and reset on background', async () => {
  const h = harness('granted', true); await flush();
  h.sendSteps(100);
  assert.equal(h.states.at(-1)?.detectedSteps, 0);
  assert.equal(h.states.at(-1)?.stepEvents, 1);
  h.sendSteps(104);
  assert.equal(h.states.at(-1)?.detectedSteps, 4);
  assert.equal(h.states.at(-1)?.stepEvents, 2);
  h.transition('background');
  assert.equal(h.states.at(-1)?.detectedSteps, 0);
  assert.equal(h.states.at(-1)?.stepEvents, 0);
  h.dispose();
});

test('pedometer counter reset rebases without inventing backfilled steps', async () => {
  const h = harness('granted', true); await flush();
  h.sendSteps(100);
  h.sendSteps(110);
  h.sendSteps(105);
  assert.equal(h.states.at(-1)?.detectedSteps, 0);
  h.sendSteps(107);
  assert.equal(h.states.at(-1)?.detectedSteps, 2);
  h.dispose();
});

test('pedometer payload stays cumulative while diagnostics use callback deltas', async () => {
  const h = harness('granted', true); await flush();
  h.sendSteps(100);
  assert.equal(h.states.at(-1)?.detectedSteps, 0);
  h.sendSteps(110);
  assert.equal(h.states.at(-1)?.detectedSteps, 10);
  h.sendSteps(115);
  assert.equal(h.states.at(-1)?.detectedSteps, 15);
  h.dispose();
});

test('pedometer reset sequence rebases cumulative payload and epoch', async () => {
  const h = harness('granted', true); await flush();
  h.sendLocation({ coords: { latitude: 35.2, longitude: 129.2, accuracy: 5 }, timestamp: Date.now() });
  h.sendSteps(100);
  const firstEpoch = h.samples.at(-1)?.sensorEpoch;
  h.sendSteps(110);
  assert.equal(h.states.at(-1)?.detectedSteps, 10);
  h.sendSteps(105);
  assert.equal(h.states.at(-1)?.detectedSteps, 0);
  const resetEpoch = h.samples.at(-1)?.sensorEpoch;
  h.sendSteps(108);
  assert.equal(h.states.at(-1)?.detectedSteps, 3);
  assert.notEqual(resetEpoch, firstEpoch);
  h.dispose();
});

test('invalid pedometer callbacks do not alter observable counters', async () => {
  const h = harness('granted', true); await flush();
  h.sendSteps(100);
  const before = h.states.at(-1);
  h.sendSteps(Number.NaN);
  h.sendSteps(-1);
  h.sendSteps(100.5);
  assert.equal(h.states.at(-1)?.detectedSteps, before?.detectedSteps);
  assert.equal(h.states.at(-1)?.stepEvents, before?.stepEvents);
  h.dispose();
});

test('a refresh that spans background and foreground cannot emit in the new sensor generation', async () => {
  const h = harness(); await flush();
  h.delayCurrent();
  const pending = h.refresh();
  h.transition('background'); h.transition('active'); await flush();
  h.resolveCurrent();
  await assert.rejects(pending, /중지되었어요/);
  assert.equal(h.samples.length, 0);
  h.dispose();
});

test('a timed-out native request cannot emit a late location', async (t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h = harness(); await flush();
  h.delayCurrent();
  const pending = h.refresh();
  const rejected = assert.rejects(pending, /시간이 걸려요/);
  t.mock.timers.tick(15_000);
  await rejected;
  h.resolveCurrent(); await flush();
  assert.equal(h.samples.length, 0);
  h.dispose();
});
