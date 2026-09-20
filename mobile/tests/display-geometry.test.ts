import assert from 'node:assert/strict';
import test from 'node:test';
import { displayGeometry } from '../src/map/displayGeometry.ts';

test('display simplification reduces coast vertices without changing the source used for GPS', () => {
  const ring: number[][] = [];
  for (let i = 0; i < 2000; i++) {
    const angle = i * Math.PI / 1000;
    ring.push([127 + Math.cos(angle), 36 + Math.sin(angle)]);
  }
  ring.push([...ring[0]]);
  const geometry = { type: 'Polygon', coordinates: [ring] };
  const original = JSON.stringify(geometry);
  const low = displayGeometry(geometry, 'sido') as typeof geometry;
  const high = displayGeometry(geometry, 'emd') as typeof geometry;
  assert.ok(low.coordinates[0].length < ring.length / 10);
  assert.ok(high.coordinates[0].length > low.coordinates[0].length);
  assert.deepEqual(low.coordinates[0][0], low.coordinates[0].at(-1));
  assert.equal(JSON.stringify(geometry), original);
});

test('small islands and holes remain closed rings with at least four coordinates', () => {
  const outer = [[127, 36], [127.001, 36], [127.001, 36.001], [127, 36]];
  const hole = [[127.0001, 36.0001], [127.0002, 36.0001], [127.0002, 36.0002], [127.0001, 36.0001]];
  const geometry = { type: 'MultiPolygon', coordinates: [[outer, hole], [outer]] };
  const result = displayGeometry(geometry, 'sido') as typeof geometry;
  assert.equal(result.coordinates.length, 2);
  assert.equal(result.coordinates[0].length, 2);
  for (const polygon of result.coordinates) for (const points of polygon) {
    assert.ok(points.length >= 4);
    assert.deepEqual(points[0], points.at(-1));
  }
});
