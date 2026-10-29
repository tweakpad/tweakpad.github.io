/*
 * The trail's route from one card to another: the shortest way across the stage that keeps a
 * clearance off every card, the second one included, and ends in a long straight run into an
 * edge of the second card, from wherever on the way that edge comes into view, at no more than a
 * set angle from straight on and never doubling back into it, so the head strikes the card rather
 * than glancing off it, and the water it drives is not bent off course before it lands. The route is planned
 * on the corners of the cards grown by the clearance: the shortest way round rectangles only ever
 * bends at their corners, so it takes the diagonals across the gaps rather than running down
 * their middles, like a line taken at speed. Where it lands varies a little from trip to trip.
 * path.ts rounds it off.
 */
import type { Box, WorldLayout } from '../scene';
import { cardBox, cardsNear, centreOf, sameCard, type CardRef, type Point } from './model';

export interface RouteOptions {
  /** How far the route keeps from the cards it passes. */
  clearance: number;
  /** The most the final run may lean from straight into the card's edge, in degrees. */
  angle: number;
  /** The straight run into the card at the end; the route's last stretch is longer still, to round the turn into it. */
  approach: number;
  /** How far from the middle of a side the impact may land, as a share of the side. */
  spread: number;
  /** How much longer than the shortest a route may be, as a share, to vary where it lands. */
  variety: number;
}

/** Where a route may leave from: a point, the point clear of its card it runs out to first, and what leaving there costs. */
export interface Departure {
  contact: Point;
  out: Point;
  /** Added to the route's length, so another departure is taken only when it saves more. */
  penalty?: number;
}

/** A point on a card's edge, and the edge's outward normal there. */
export interface EdgePoint {
  contact: Point;
  normal: Point;
}

export interface Route {
  /** The departure, the corners it bends round, and the impact. */
  points: Point[];
  impact: EdgePoint;
  /** The cards it kept clear of, grown by the clearance, for the debug view. */
  obstacles: Box[];
}

/** The last stretch is this much longer than the approach, so the turn into it can be rounded. */
const ROOM = 1.4;
/** The sharpest turn into the last stretch: the cosine of about 100°, so it never doubles back. */
const TURN = -0.17;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const along = (point: Point, normal: Point, length: number): Point => [
  point[0] + normal[0] * length,
  point[1] + normal[1] * length,
];

const grow = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 });

const inside = (point: Point, box: Box, slack = 0.5) =>
  point[0] > box.x + slack &&
  point[0] < box.x + box.w - slack &&
  point[1] > box.y + slack &&
  point[1] < box.y + box.h - slack;

/** Whether the segment from `a` to `b` runs through the box's inside (Liang–Barsky clipping). */
function crosses(a: Point, b: Point, box: Box, slack = 0.5): boolean {
  const left = box.x + slack;
  const right = box.x + box.w - slack;
  const top = box.y + slack;
  const bottom = box.y + box.h - slack;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - left) &&
    clip(dx, right - a[0]) &&
    clip(-dy, a[1] - top) &&
    clip(dy, bottom - a[1]) &&
    t1 - t0 > 1e-6
  );
}

/**
 * Points along each side of a card: its middle and either side of it, as far as `spread` allows,
 * each moved a little at random.
 */
export function edgePoints(box: Box, spread: number, random: () => number): EdgePoint[] {
  const points: EdgePoint[] = [];
  const shares = [0.5 - spread / 2, 0.5, 0.5 + spread / 2];
  const jitter = () => (random() - 0.5) * spread * 0.3;
  for (const share of shares) {
    const s = Math.min(0.9, Math.max(0.1, share + jitter()));
    points.push({ contact: [box.x + box.w * s, box.y], normal: [0, -1] });
    points.push({ contact: [box.x + box.w * s, box.y + box.h], normal: [0, 1] });
  }
  for (const share of shares) {
    const s = Math.min(0.9, Math.max(0.1, share + jitter()));
    points.push({ contact: [box.x, box.y + box.h * s], normal: [-1, 0] });
    points.push({ contact: [box.x + box.w, box.y + box.h * s], normal: [1, 0] });
  }
  return points;
}

/**
 * Plans a route from any of `departures` into card `to`; `random` gives 0..1. Gaps narrower than
 * twice the clearance are tried again with less of it.
 */
export function planRoute(
  layout: WorldLayout,
  departures: readonly Departure[],
  to: CardRef,
  options: RouteOptions,
  random: () => number = Math.random,
): Route | undefined {
  const target = cardBox(layout, to);
  if (!target || !departures.length) return undefined;
  const centre = centreOf(target);
  const start = departures[0]!.out;
  const middle: Point = [(start[0] + centre[0]) / 2, (start[1] + centre[1]) / 2];
  const reach = distance(start, centre) / 2 + layout.columnWidth * 2;
  const cards = cardsNear(layout, middle, reach)
    .filter((card) => !sameCard(card.ref, to))
    .map((card) => cardBox(layout, card.ref)!);
  const landings = edgePoints(target, options.spread, random);
  const narrowest = Math.min(layout.gap[0], layout.gap[1]);
  for (const clearance of [options.clearance, Math.min(options.clearance, narrowest / 2 - 4), 2]) {
    const route = attempt(cards, target, departures, landings, Math.max(0, clearance), options, random);
    if (route) return route;
  }
  return undefined;
}

function attempt(
  cards: readonly Box[],
  target: Box,
  departures: readonly Departure[],
  landings: readonly EdgePoint[],
  clearance: number,
  options: RouteOptions,
  random: () => number,
): Route | undefined {
  // The second card is in the way like any other, but for the final run into it.
  const others = cards.map((card) => grow(card, clearance));
  const obstacles = [...others, grow(target, clearance)];
  const blocked = (point: Point) => obstacles.some((box) => inside(point, box));
  const clear = (a: Point, b: Point) => !obstacles.some((box) => crosses(a, b, box));
  const steep = Math.cos((Math.min(89, Math.max(0, options.angle)) * Math.PI) / 180);
  // The last stretch is the straight approach, and room before it to round the turn into it.
  const stretch = options.approach * ROOM;
  /**
   * Whether the last stretch may run from `from` into `landing`, arriving along `heading`: long
   * enough, steep enough to strike, never doubling back on the way it came, clear of the other
   * cards, and never through the second.
   */
  const strikes = (from: Point, heading: Point | undefined, landing: EdgePoint) => {
    const dx = landing.contact[0] - from[0];
    const dy = landing.contact[1] - from[1];
    const run = Math.hypot(dx, dy);
    if (run < stretch) return false;
    const toward = -(dx * landing.normal[0] + dy * landing.normal[1]);
    if (toward / run < steep) return false;
    if (heading && (heading[0] * dx + heading[1] * dy) / run < TURN) return false;
    return !crosses(from, landing.contact, target) && !others.some((box) => crosses(from, landing.contact, box));
  };

  // The graph: where the route may leave from, the grown corners, and, just off each landing,
  // a point to run in from straight on, for edges no corner sees at a steep enough angle. The
  // landings end the route: nothing leads on from them.
  const sources = departures.filter((departure) => !blocked(departure.out));
  if (!sources.length) return undefined;
  const points: Point[] = sources.map((source) => source.out);
  for (const box of obstacles) {
    for (const corner of [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x, box.y + box.h],
      [box.x + box.w, box.y + box.h],
    ] as Point[]) {
      if (!blocked(corner)) points.push(corner);
    }
  }
  for (const landing of landings) {
    const front = along(landing.contact, landing.normal, stretch);
    if (!blocked(front)) points.push(front);
  }
  const ends = points.length;
  const nodes: Point[] = [...points, ...landings.map((landing) => landing.contact)];
  const cost = new Float64Array(nodes.length).fill(Infinity);
  const previous = new Int32Array(nodes.length).fill(-1);
  const done = new Uint8Array(nodes.length);
  sources.forEach((source, i) => (cost[i] = distance(source.contact, source.out) + (source.penalty ?? 0)));
  /** The way the route arrives at node `u`, as a unit vector. */
  const heading = (u: number): Point | undefined => {
    const from = u < sources.length ? sources[u]!.contact : previous[u]! >= 0 ? nodes[previous[u]!] : undefined;
    if (!from) return undefined;
    const dx = nodes[u]![0] - from[0];
    const dy = nodes[u]![1] - from[1];
    const length = Math.hypot(dx, dy);
    return length > 0.5 ? [dx / length, dy / length] : undefined;
  };

  // Dijkstra over the visibility graph; it is small, so every pair is tested as it is reached.
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i += 1) if (!done[i] && cost[i]! < (u < 0 ? Infinity : cost[u]!)) u = i;
    if (u < 0 || cost[u] === Infinity) break;
    done[u] = 1;
    if (u >= ends) continue;
    for (let v = 0; v < nodes.length; v += 1) {
      if (done[v] || v === u) continue;
      const next = cost[u]! + distance(nodes[u]!, nodes[v]!);
      if (next >= cost[v]!) continue;
      const reachable = v >= ends ? strikes(nodes[u]!, heading(u), landings[v - ends]!) : clear(nodes[u]!, nodes[v]!);
      if (reachable) {
        cost[v] = next;
        previous[v] = u;
      }
    }
  }

  // The shortest way in, or, at random, any other within the variety of it.
  const choices = landings
    .map((landing, i) => ({ landing, node: ends + i, total: cost[ends + i]! }))
    .filter((choice) => Number.isFinite(choice.total));
  if (!choices.length) return undefined;
  const best = Math.min(...choices.map((choice) => choice.total));
  const near = choices.filter((choice) => choice.total <= best * (1 + options.variety));
  const chosen = near[Math.floor(random() * near.length)]!;

  const chain: Point[] = [];
  let node = chosen.node;
  while (node >= 0) {
    chain.unshift(nodes[node]!);
    if (node < sources.length) {
      const contact = sources[node]!.contact;
      if (distance(contact, nodes[node]!) > 0.5) chain.unshift(contact);
      break;
    }
    node = previous[node]!;
  }
  return { points: chain, impact: chosen.landing, obstacles };
}
