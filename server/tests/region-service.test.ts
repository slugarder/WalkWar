import assert from 'node:assert/strict';
import test from 'node:test';
import { setup, IDS } from './support/fixture.js';

test('real-source GPS lookup retains the ward, enclosing city, and province hierarchy',t=>{
  const h=setup(t);const location=h.regions.get(IDS.suwon).region.center!;
  const result=h.regions.at(location.lat,location.lon);
  assert.equal(result.region!.id,IDS.suwon);
  assert.deepEqual(result.ancestors.map(r=>r.id),['mois:4100000000',IDS.suwonCity,IDS.suwonWard]);
  assert.equal(h.regions.at(location.lat,location.lon,'sigungu').region!.id,IDS.suwonWard);
  assert.ok(h.regions.containsResolvedTarget(IDS.suwonCity,result.region,location.lat,location.lon));
});

test('a small Busan viewport excludes real Seoul and Jeju polygons and aggregate city overlays',t=>{
  const h=setup(t);const center=h.regions.get(IDS.busan).region.center!;
  const map=h.regions.map('emd',center.lon-.02,center.lat-.02,center.lon+.02,center.lat+.02,80);
  const ids=map.features.map(f=>f.region.id);
  assert.ok(ids.includes(IDS.busan));
  assert.ok(!ids.includes(IDS.seoul),'Seoul lies outside the Busan viewport');
  assert.ok(!ids.includes(IDS.jeju),'Jeju lies outside the Busan viewport');
  const middle=h.regions.map('sigungu',124,32,132,39,80);
  assert.ok(!middle.features.some(f=>f.region.id===IDS.suwonCity),'enclosing city is explicit-selection only');
  assert.ok(middle.features.some(f=>f.region.id===IDS.suwonWard));
});

