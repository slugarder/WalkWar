import type { AreaLevel } from './regions.ts';

type Point = [number, number];
type Polygon = Point[][];
const tolerance: Record<AreaLevel, number> = { sido: .01, city: .003, sigungu: .0005, emd: .00005 };

function distanceSquared(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return (point[0] - start[0] - t * dx) ** 2 + (point[1] - start[1] - t * dy) ** 2;
}

function ring(points: Point[], epsilon: number): Point[] {
  if (points.length < 4) return points;
  // Iterative Douglas–Peucker avoids recursion on long coastal rings.
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [0, points.length - 1], limit = epsilon * epsilon;
  while (stack.length) {
    const end = stack.pop()!, start = stack.pop()!;
    let farthest = -1, distance = limit;
    for (let i = start + 1; i < end; i++) {
      const candidate = distanceSquared(points[i], points[start], points[end]);
      if (candidate > distance) { distance = candidate; farthest = i; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push(start, farthest, farthest, end);
    }
  }
  const simplified = points.filter((_, index) => keep[index]);
  // Keep small islands and holes valid instead of collapsing them into a line.
  const selected = simplified.length >= 4 ? simplified : points;
  const rounded: Point[] = selected.map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
  return new Set(rounded.map(point => point.join(','))).size >= 3 ? rounded : selected.map(point => [...point]);
}

/** Display only: authoritative GPS membership continues to use server geometry. */
export function displayGeometry(geometry: unknown, level: AreaLevel): unknown {
  if (!geometry || typeof geometry !== 'object') return geometry;
  const value = geometry as { type: string; coordinates: unknown };
  if (!Array.isArray(value.coordinates)) return geometry;
  if (value.type === 'Polygon') return { type: value.type, coordinates: (value.coordinates as Polygon).map(points => ring(points, tolerance[level])) };
  if (value.type === 'MultiPolygon') return { type: value.type, coordinates: (value.coordinates as Polygon[]).map(polygon => polygon.map(points => ring(points, tolerance[level]))) };
  return geometry;
}
