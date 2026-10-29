/*
 * Rounds a route (route.ts) into the path the trail head follows. Each corner becomes a cubic
 * curve between two points on its runs, as far from the corner as the radius asks, never more
 * than half a run, and never so far that the curve cuts deeper than the route's clearance toward
 * the card it bends round. The two endings (the run out of the first card and the turn into the
 * second) and the corners in between each have their own rounding, and the straight runs can
 * weave a little from side to side; but the final run into the card stays straight for its whole
 * approach, so the water the head drives along it strikes the card head on. The result is sampled every few pixels with its arc length,
 * so the head can move along it at any speed.
 */
import type { Smoothing } from './params';
import type { Point } from './model';

export interface Path {
  xs: Float64Array;
  ys: Float64Array;
  /** The arc length at each sample. */
  s: Float64Array;
  /** The curve's radius at each sample; Infinity on the straight runs. */
  radius: Float64Array;
  /** 1 where the sample lies on an ending. */
  ending: Uint8Array;
  length: number;
  /** The arc length where the final straight run into the card begins. */
  straightFrom: number;
}

/** Pixels between samples on the straight runs. */
const STEP = 4;

interface Piece {
  /** A straight run, or a corner's cubic curve. */
  points: readonly Point[];
  curve: boolean;
  radius: number;
  ending: boolean;
  /** The final run into the card, which never weaves. */
  final?: boolean;
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point, k = 1): Point => [a[0] + b[0] * k, a[1] + b[1] * k];
const norm = (a: Point): Point => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
const cubic = (p: readonly Point[], t: number): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p[0]![0] + b * p[1]![0] + c * p[2]![0] + d * p[3]![0],
    a * p[0]![1] + b * p[1]![1] + c * p[2]![1] + d * p[3]![1],
  ];
};

/**
 * Rounds `points` into a path. The corners next to either end are the endings'; the rest are the
 * hallways'. `limit` is how far inside a corner its curve may reach: the route's corners keep
 * that clearance from the cards they bend round. The last `straight` pixels stay straight.
 */
export function smoothPath(
  points: readonly Point[],
  endings: Smoothing,
  halls: Smoothing,
  limit: number,
  straight: number,
): Path {
  const n = points.length;
  const isEnding = (corner: number) => corner <= 1 || corner >= n - 2;
  // Each corner's cut: how far along its runs the curve starts and ends.
  const cuts = new Array<number>(n).fill(0);
  const radii = new Array<number>(n).fill(Infinity);
  for (let i = 1; i < n - 1; i += 1) {
    const before = sub(points[i]!, points[i - 1]!);
    const after = sub(points[i + 1]!, points[i]!);
    const lengthIn = Math.hypot(...before);
    const lengthOut = Math.hypot(...after);
    const din = norm(before);
    const dout = norm(after);
    const turn = Math.acos(Math.max(-1, Math.min(1, din[0] * dout[0] + din[1] * dout[1])));
    if (turn < 1e-3 || lengthIn < 1e-3 || lengthOut < 1e-3) continue;
    const half = Math.tan(turn / 2);
    // A curve's middle sits r(sec(φ/2) - 1) inside the corner, which must stay clear of the card.
    const reach = 1 / Math.cos(turn / 2) - 1;
    const radius = Math.min((isEnding(i) ? endings : halls).radius, reach > 1e-6 ? Math.max(0, limit) / reach : Infinity);
    // The turn into the final run leaves its approach straight.
    const outward = i === n - 2 ? Math.max(0, lengthOut - straight) : lengthOut / 2;
    const cut = Math.min(radius * half, lengthIn / 2, outward);
    cuts[i] = cut;
    radii[i] = cut / half;
  }

  const pieces: Piece[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dir = norm(sub(b, a));
    const from = add(a, dir, cuts[i]!);
    const to = add(b, dir, -cuts[i + 1]!);
    pieces.push({ points: [from, to], curve: false, radius: Infinity, ending: i === 0 || i === n - 2, final: i === n - 2 });
    if (i + 1 < n - 1 && cuts[i + 1]! > 0) {
      const corner = points[i + 1]!;
      const next = norm(sub(points[i + 2]!, corner));
      const exit = add(corner, next, cuts[i + 1]!);
      const tension = (isEnding(i + 1) ? endings : halls).tension;
      pieces.push({
        points: [to, add(to, dir, cuts[i + 1]! * tension), add(exit, next, -cuts[i + 1]! * tension), exit],
        curve: true,
        radius: radii[i + 1]!,
        ending: isEnding(i + 1),
      });
    }
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const radius: number[] = [];
  const ending: number[] = [];
  const push = (point: Point, r: number, end: boolean) => {
    xs.push(point[0]);
    ys.push(point[1]);
    radius.push(r);
    ending.push(end ? 1 : 0);
  };
  push(pieces[0]!.points[0]!, Infinity, true);
  let straightAt = 0;
  for (const piece of pieces) {
    if (piece.final) straightAt = xs.length - 1;
    if (piece.curve) {
      const p = piece.points;
      const rough = Math.hypot(...sub(p[1]!, p[0]!)) + Math.hypot(...sub(p[2]!, p[1]!)) + Math.hypot(...sub(p[3]!, p[2]!));
      const count = Math.max(4, Math.ceil(rough / STEP));
      for (let j = 1; j <= count; j += 1) push(cubic(p, j / count), piece.radius, piece.ending);
      continue;
    }
    const [a, b] = piece.points as [Point, Point];
    const run = Math.hypot(...sub(b, a));
    const count = Math.max(1, Math.ceil(run / STEP));
    const sway = piece.final ? { ...endings, sway: 0 } : piece.ending ? endings : halls;
    const normal: Point = norm([-(b[1] - a[1]), b[0] - a[0]]);
    for (let j = 1; j <= count; j += 1) {
      const t = j / count;
      // The weave fades in and out with the run, so it is still at every corner.
      const weave = sway.sway * Math.sin((Math.PI * 2 * t * run) / Math.max(1, sway.wavelength)) * Math.sin(Math.PI * t) ** 2;
      push(add(add(a, sub(b, a), t), normal, weave), Infinity, piece.ending);
    }
  }

  const s = new Float64Array(xs.length);
  for (let i = 1; i < xs.length; i += 1) s[i] = s[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    s,
    radius: Float64Array.from(radius),
    ending: Uint8Array.from(ending),
    length: s[s.length - 1] ?? 0,
    straightFrom: s[straightAt] ?? 0,
  };
}

/** The sample at or just before arc length `at`. */
export function sampleAt(path: Path, at: number): number {
  let low = 0;
  let high = path.s.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (path.s[mid]! <= at) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The point at arc length `at`, clamped to the path. */
export function pointAt(path: Path, at: number): Point {
  const s = Math.max(0, Math.min(path.length, at));
  const i = sampleAt(path, s);
  const j = Math.min(i + 1, path.s.length - 1);
  const span = path.s[j]! - path.s[i]!;
  const t = span > 0 ? (s - path.s[i]!) / span : 0;
  return [path.xs[i]! + (path.xs[j]! - path.xs[i]!) * t, path.ys[i]! + (path.ys[j]! - path.ys[i]!) * t];
}

/** The arc length of the point on the path nearest `point`. */
export function project(path: Path, point: Point): number {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < path.s.length; i += 1) {
    const d = Math.hypot(path.xs[i]! - point[0], path.ys[i]! - point[1]);
    if (d < distance) [distance, best] = [d, path.s[i]!];
  }
  return best;
}
