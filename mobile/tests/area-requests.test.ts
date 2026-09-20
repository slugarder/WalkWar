import assert from 'node:assert/strict';
import test from 'node:test';
import { createAreaRequests, type AreaDisplay, type MapViewport } from '../src/map/areaRequests.ts';
import type { MapAreas } from '../src/map/regions.ts';

const viewport = (lng: number, zoom = 10): MapViewport => ({ lng, lat: 37.5, zoom, west: lng - .1, east: lng + .1, south: 37.4, north: 37.6 });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('rapid settled viewports keep only one geometry request and the latest pending target', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: number[] = [], releases: Array<(value: MapAreas) => void> = [];
  const shown: AreaDisplay[] = [];
  const requests = createAreaRequests(bounds => {
    calls.push(bounds.west);
    return new Promise(resolve => releases.push(resolve));
  }, value => shown.push(value));
  requests.schedule(viewport(127)); t.mock.timers.tick(350);
  requests.schedule(viewport(128)); t.mock.timers.tick(350);
  requests.schedule(viewport(129)); t.mock.timers.tick(350);
  assert.deepEqual(calls, [126.9]);
  releases[0]({ features: [] }); await settle();
  assert.deepEqual(calls, [126.9, 128.9]);
  assert.equal(shown.filter(value => value.level !== null).length, 0, 'stale geometry never reaches the map');
  releases[1]({ features: [] }); await settle();
  assert.equal(shown.at(-1)?.level, 'sigungu');
  requests.dispose();
});

test('zooming out hides flags and prevents an older response from restoring them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (value: MapAreas) => void;
  const shown: AreaDisplay[] = [];
  const requests = createAreaRequests(() => new Promise(resolve => { release = resolve; }), value => shown.push(value));
  requests.schedule(viewport(127)); t.mock.timers.tick(350);
  requests.schedule(viewport(127, 3));
  release({ features: [] }); await settle();
  assert.ok(shown.every(value => value.level === null));
  requests.dispose();
});

test('unmount disposes pending work and ignores an in-flight result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (value: MapAreas) => void;
  let calls = 0;
  const shown: AreaDisplay[] = [];
  const requests = createAreaRequests(() => { calls++; return new Promise(resolve => { release = resolve; }); }, value => shown.push(value));
  requests.schedule(viewport(127)); t.mock.timers.tick(350);
  requests.schedule(viewport(128));
  requests.dispose(); t.mock.timers.tick(350);
  release({ features: [] }); await settle();
  assert.equal(calls, 1);
  assert.ok(shown.every(value => value.level === null));
});
