import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { routes } from '../src/domain/game/api/routes.js';
import { setup, IDS } from './support/fixture.js';

function appFor(h: ReturnType<typeof setup>) {
  const app = Fastify({ logger: false });
  routes(app, h.game, h.regions);
  return app;
}

test('health and root regions expose the catalogue contract', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());

  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
  assert.equal(typeof health.json().dataInfo.regionCount, 'number');

  const roots = await app.inject({ method: 'GET', url: '/api/v1/regions' });
  assert.equal(roots.statusCode, 200);
  const body = roots.json();
  assert.ok(Array.isArray(body.regions));
  assert.ok(body.regions.length > 0);
  assert.ok(body.regions.every((region: any) => region.parentId === null));
  assert.equal(typeof body.total, 'number');
});

test('region descriptions are Korean and map/detail captures start null per mode', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());
  const region = h.regions.get(IDS.busan).region;
  const center = region.center!;

  const detail = await app.inject({ method: 'GET', url: `/api/v1/regions/${IDS.busan}?mode=virtual` });
  assert.equal(detail.statusCode, 200);
  const detailRegion = detail.json().region;
  assert.match(detailRegion.description, /부산|행정구역/);
  assert.doesNotMatch(detailRegion.description, /\b(?:sido|sigungu|emd)\b/);
  assert.equal(detailRegion.capture, null);

  const map = await app.inject({
    method: 'GET',
    url: `/api/v1/map/regions?level=emd&west=${center.lon - 0.02}&south=${center.lat - 0.02}&east=${center.lon + 0.02}&north=${center.lat + 0.02}&mode=virtual`,
  });
  assert.equal(map.statusCode, 200);
  const feature = map.json().features.find((item: any) => item.region.id === IDS.busan);
  assert.ok(feature, 'Busan fixture region should be in its local map viewport');
  assert.equal(feature.region.capture, null);

  const gpsDetail = await app.inject({ method: 'GET', url: `/api/v1/regions/${IDS.busan}?mode=gps` });
  assert.equal(gpsDetail.statusCode, 200);
  assert.equal(gpsDetail.json().region.capture, null);
});

test('region-at returns the selected ancestor path and rejects invalid coordinates with the API error body', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());
  const location = h.regions.get(IDS.suwon).region.center!;

  const located = await app.inject({ method: 'GET', url: `/api/v1/map/region-at?lat=${location.lat}&lon=${location.lon}&level=sigungu` });
  assert.equal(located.statusCode, 200);
  assert.equal(located.json().region.id, IDS.suwonWard);
  assert.deepEqual(located.json().ancestors.map((item: any) => item.id), ['mois:4100000000', IDS.suwonCity, IDS.suwonWard]);
  assert.match(located.json().region.description, /행정구역/);

  const invalid = await app.inject({ method: 'GET', url: '/api/v1/map/region-at?lat=not-a-coordinate&lon=129' });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), {
    error: { code: 'INVALID_INPUT', message: '좌표가 필요합니다.', retryable: false },
  });
});

test('player join and GPS browsing require explicit region selection', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/players',
    payload: { clientId: 'test-client', displayName: '테스트 여행자' },
  });
  assert.equal(joined.statusCode, 200);
  assert.equal(joined.json().player.id, h.id);

  const browsing = await app.inject({
    method: 'POST',
    url: `/api/v1/players/${h.id}/session`,
    payload: { requestId: h.request(), mode: 'gps' },
  });
  assert.equal(browsing.statusCode, 200);
  assert.equal(browsing.json().player.regionId, null);

  const point = h.regions.get(IDS.busan).region.center!;
  const gps = await app.inject({
    method: 'POST',
    url: `/api/v1/players/${h.id}/gps`,
    payload: { sessionId: browsing.json().sessionId, requestId: h.request(), seq: 1, lat: point.lat, lon: point.lon, accuracyM: 8, capturedAt: h.now(), stepCounter: 0, sensorEpoch: 'api-fixture' },
  });
  assert.equal(gps.statusCode, 200);
  assert.equal(gps.json().player.regionId, null);

  const selected = await app.inject({
    method: 'POST',
    url: `/api/v1/players/${h.id}/session`,
    payload: { requestId: h.request(), mode: 'gps', regionId: IDS.busan },
  });
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.json().player.regionId, IDS.busan);
});

test('virtual victory is visible in map/detail capture and GPS capture remains null', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());
  const started = await app.inject({
    method: 'POST',
    url: `/api/v1/players/${h.id}/session`,
    payload: { requestId: h.request(), mode: 'virtual', regionId: IDS.busan },
  });
  assert.equal(started.statusCode, 200);
  h.victory();
  const history = h.game.history(h.id, { regionId: IDS.busan });
  const defeat = history.records[0];
  assert.ok(defeat);

  const detail = await app.inject({ method: 'GET', url: `/api/v1/regions/${IDS.busan}?mode=virtual` });
  assert.equal(detail.statusCode, 200);
  const capture = detail.json().region.capture;
  assert.ok(capture);
  assert.equal(capture.defeatedAt, defeat.defeatedAt);
  assert.ok(capture.teams.length > 0);
  assert.ok(capture.teams.every((team: any) => team.rank === 1 && typeof team.flag === 'string'));

  const center = h.regions.get(IDS.busan).region.center!;
  const map = await app.inject({ method: 'GET', url: `/api/v1/map/regions?level=emd&west=${center.lon - 0.02}&south=${center.lat - 0.02}&east=${center.lon + 0.02}&north=${center.lat + 0.02}&mode=virtual` });
  const mapped = map.json().features.find((item: any) => item.region.id === IDS.busan);
  assert.deepEqual(mapped.region.capture, capture);

  const gpsMap = await app.inject({ method: 'GET', url: `/api/v1/map/regions?level=emd&west=${center.lon - 0.02}&south=${center.lat - 0.02}&east=${center.lon + 0.02}&north=${center.lat + 0.02}&mode=gps` });
  const gpsMapped = gpsMap.json().features.find((item: any) => item.region.id === IDS.busan);
  assert.equal(gpsMapped.region.capture, null);
});

test('invalid parameters and wrong sessions preserve 400/409 API error bodies', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());

  const invalid = await app.inject({ method: 'GET', url: '/api/v1/regions?level=continent' });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: { code: 'INVALID_INPUT', message: '지원하지 않는 지역 레벨입니다.', retryable: false } });

  const started = await app.inject({ method: 'POST', url: `/api/v1/players/${h.id}/session`, payload: { requestId: h.request(), mode: 'virtual', regionId: IDS.busan } });
  const wrongSession = await app.inject({ method: 'PUT', url: `/api/v1/players/${h.id}/input`, payload: { sessionId: 'wrong-session', seq: 1, axisX: 1, axisY: 0 } });
  assert.equal(started.statusCode, 200);
  assert.equal(wrongSession.statusCode, 409);
  assert.deepEqual(wrongSession.json(), { error: { code: 'STALE_SESSION', message: '세션이 만료되었습니다. 모드를 다시 선택해 주세요.', retryable: false } });
});

test('sigungu map overview switches between aggregate city and detailed ward features', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());
  const center = h.regions.get(IDS.suwon).region.center!;
  const bounds = `west=${center.lon - 0.02}&south=${center.lat - 0.02}&east=${center.lon + 0.02}&north=${center.lat + 0.02}`;

  const overview = await app.inject({ method: 'GET', url: `/api/v1/map/regions?level=sigungu&overview=true&${bounds}` });
  assert.equal(overview.statusCode, 200);
  const overviewIds = overview.json().features.map((item: any) => item.region.id);
  assert.ok(overviewIds.includes(IDS.suwonCity));
  assert.ok(!overviewIds.includes(IDS.suwonWard));

  const detailed = await app.inject({ method: 'GET', url: `/api/v1/map/regions?level=sigungu&${bounds}` });
  assert.equal(detailed.statusCode, 200);
  const detailedIds = detailed.json().features.map((item: any) => item.region.id);
  assert.ok(detailedIds.includes(IDS.suwonWard));
  assert.ok(!detailedIds.includes(IDS.suwonCity));
});

test('region search accepts the official administrative name alias', async t => {
  const h = setup(t);
  const app = appFor(h);
  t.after(() => void app.close());
  const result = await app.inject({ method: 'GET', url: '/api/v1/regions?q=%EB%B6%80%EC%A0%841%EB%8F%99' });
  assert.equal(result.statusCode, 200);
  assert.ok(result.json().regions.some((region: any) => region.name === '부전제1동' || region.fullName.includes('부전제1동')));
});
