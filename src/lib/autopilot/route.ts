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
import { cardBox, cardsNear, centreOf, keyOf, sameCard, type CardRef, type Point } from './model';

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
  /** The straight run the head's burst would have, which the route keeps where one fits. */
  runUp: number;
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
/** How many times a route is planned again around cards the corridor left out. */
const PASSES = 6;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const along = (point: Point, normal: Point, length: number): Point => [
  point[0] + normal[0] * length,
  point[1] + normal[1] * length,
];

/** How far `point` is from the segment from `a` to `b`. */
const segmentDistance = (point: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
};

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
  // Most boxes are nowhere near the segment.
  if (Math.max(a[0], b[0]) <= left || Math.min(a[0], b[0]) >= right) return false;
  if (Math.max(a[1], b[1]) <= top || Math.min(a[1], b[1]) >= bottom) return false;
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
  const nearby = cardsNear(layout, middle, distance(start, centre) / 2 + layout.columnWidth * 2).filter(
    (card) => !sameCard(card.ref, to),
  );
  const landings = edgePoints(target, options.spread, random);
  const narrowest = Math.min(layout.gap[0], layout.gap[1]);
  // Only the cards in a corridor along the way, widened when no route fits: the graph's cost
  // grows with the square of the cards in it, and a long trip has many around it.
  for (const width of [1.5, 3]) {
    const corridor = layout.columnWidth * width;
    const cards = nearby
      .filter((card) => {
        const box = cardBox(layout, card.ref)!;
        return segmentDistance(card.centre, start, centre) - Math.hypot(box.w, box.h) / 2 <= corridor;
      })
      .map((card) => card.ref);
    // Less clearance only helps where the gaps are too narrow for it.
    const clearances =
      narrowest < options.clearance * 2 + 8 ? [options.clearance, Math.min(options.clearance, narrowest / 2 - 4), 2] : [options.clearance];
    for (const clearance of clearances) {
      const route = plan(layout, cards, to, target, departures, landings, Math.max(0, clearance), options, random);
      if (route) return route;
    }
  }
  return undefined;
}

/**
 * Plans among `cards`, then checks the route against every card along it: the corridor leaves
 * out the cards a detour may swing past, so one the route runs into joins the others, and the
 * route is planned again around it.
 */
function plan(
  layout: WorldLayout,
  refs: readonly CardRef[],
  to: CardRef,
  target: Box,
  departures: readonly Departure[],
  landings: readonly EdgePoint[],
  clearance: number,
  options: RouteOptions,
  random: () => number,
): Route | undefined {
  const cards = [...refs];
  const known = new Set(cards.map(keyOf));
  for (let pass = 0; pass < PASSES; pass += 1) {
    const boxes = cards.map((ref) => cardBox(layout, ref)!);
    const route = attempt(boxes, target, departures, landings, clearance, options, random);
    if (!route) return undefined;
    const missed = passedBy(layout, route.points, clearance).filter((ref) => !sameCard(ref, to) && !known.has(keyOf(ref)));
    if (!missed.length) return route;
    for (const ref of missed) {
      known.add(keyOf(ref));
      cards.push(ref);
    }
  }
  return undefined;
}

/** The cards whose clearance the route's runs cut into. */
function passedBy(layout: WorldLayout, points: readonly Point[], clearance: number): CardRef[] {
  let tallest = 0;
  for (const column of layout.columns) for (const item of column.items) tallest = Math.max(tallest, item.card.h);
  // A card a run cuts into has its centre within half its diagonal, and the clearance, of the run.
  const reach = Math.hypot(layout.columnWidth, tallest) / 2 + clearance;
  const found: CardRef[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const card of cardsNear(layout, middle, distance(a, b) / 2 + reach)) {
      if (found.some((ref) => sameCard(ref, card.ref))) continue;
      if (crosses(a, b, grow(cardBox(layout, card.ref)!, clearance))) found.push(card.ref);
    }
  }
  return found;
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
  // The last stretch is the straight approach, and room before it to round the turn into it;
  // where a longer one fits, it gives the head's whole burst a straight run.
  const stretch = options.approach * ROOM;
  const long = Math.max(stretch, options.runUp + stretch - options.approach);
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

  // The graph: where the route may leave from, the grown corners, and, off each landing, points
  // to run in from straight on, for edges no corner sees at a steep enough angle: one just far
  // enough, one as far as the run-up. The landings end the route: nothing leads on from them.
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
    for (const length of long > stretch ? [stretch, long] : [stretch]) {
      const front = along(landing.contact, landing.normal, length);
      if (!blocked(front)) points.push(front);
    }
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

  // A* over the visibility graph, toward the card; it is small, so every pair is tested as it is
  // reached. It stops once no landing within the variety of the best can still be found.
  const towardCard = nodes.map((point) => {
    const dx = Math.max(target.x - point[0], 0, point[0] - (target.x + target.w));
    const dy = Math.max(target.y - point[1], 0, point[1] - (target.y + target.h));
    return Math.hypot(dx, dy);
  });
  let landed = Infinity;
  for (;;) {
    let u = -1;
    let lowest = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const estimate = cost[i]! + towardCard[i]!;
      if (!done[i] && estimate < lowest) [u, lowest] = [i, estimate];
    }
    if (u < 0 || lowest === Infinity || lowest > landed * (1 + options.variety)) break;
    done[u] = 1;
    if (u >= ends) {
      landed = Math.min(landed, cost[u]!);
      continue;
    }
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

  // The shortest way in, or, at random, any other within the variety of it: the longer its last
  // stretch, up to the run-up, the likelier.
  const choices = landings
    .map((landing, i) => ({ landing, node: ends + i, total: cost[ends + i]! }))
    .filter((choice) => done[choice.node] && Number.isFinite(choice.total));
  if (!choices.length) return undefined;
  const best = Math.min(...choices.map((choice) => choice.total));
  const near = choices.filter((choice) => choice.total <= best * (1 + options.variety));
  const weights = near.map((choice) => {
    const run = distance(nodes[previous[choice.node]!]!, choice.landing.contact);
    return (Math.min(run, long) / long) ** 2;
  });
  let pick = random() * weights.reduce((sum, weight) => sum + weight, 0);
  let chosen = near[near.length - 1]!;
  for (let i = 0; i < near.length; i += 1) {
    pick -= weights[i]!;
    if (pick <= 0) {
      chosen = near[i]!;
      break;
    }
  }

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
