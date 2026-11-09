/*
 * The home canvas's mosaic: measured cards packed without gaps and with one gutter, endless in
 * every direction.
 *
 * Every footprint (card + caption) is packed inflated by the gutter, so inflated footprints tile
 * the plane exactly and every gutter is the gutter by construction. The world repeats across
 * `period`; up and down it grows lazily from two skyline fronts. A step fills the lowest stretch
 * of a front completely, with cards whose widths are chosen inside their ranges so that whatever is
 * left can always be filled too; nothing behind a front is ever left empty. Heights snap to a
 * neighbouring stretch when their ranges allow, which merges stretches so no columns or rows line
 * up for long.
 *
 * The opening is part of the same packing: a hero slot centred on the origin, a clear gutter from
 * its bottom down x = 0, and a landing card centred under it where both sides of that gutter meet
 * at one depth.
 */

export interface Range {
  min: number;
  pref: number;
  max: number;
}

/** A pattern as measured on the page; sizes in CSS pixels. Nothing about it is assumed. */
export interface MosaicCard {
  key: string;
  /** The card's width range. */
  width: Range;
  /** The card's body height range. */
  height: Range;
  /** Measured minimum body heights at some widths: content always fits, whatever the range says. */
  floor?: readonly { width: number; minHeight: number }[];
  /** The caption under the card: the space above it, and its own size. */
  caption: { gap: number; width: number; height: number };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MosaicItem {
  /** The card's `key` in the catalog: the pattern it shows. */
  pattern: string;
  /** The footprint (card and caption), in world pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The card and the caption, relative to the footprint. */
  card: Box;
  caption: Box;
  role?: 'hero' | 'landing';
}

export interface MosaicOptions {
  gap: readonly [number, number];
  /** The horizontal period to aim for; the world repeats across it. */
  period: number;
  seed?: number;
  /** The opening card's natural size, centred on the origin; it takes a real card's slot. */
  hero?: { width: number; height: number };
  /** The opening's distance from the hero's bottom to the landing card's top, at least. */
  landingDepth?: number;
}

export interface Mosaic {
  readonly items: readonly MosaicItem[];
  readonly period: number;
  readonly hero: number | undefined;
  /** The landing card's index; generated with the first `ensure` that reaches it. */
  readonly landing: number | undefined;
  /** Generates every card overlapping world rows [top, bottom]. */
  ensure(top: number, bottom: number): void;
  /** Visits every copy of a card whose footprint overlaps `box`: its index and period copy. */
  query(box: Box, visit: (index: number, k: number) => void): void;
  /** Cards placed outside their measured ranges; always 0 unless the catalog cannot fit. */
  readonly violations: number;
}

type Iv = [number, number];
const TOL = 1e-3;

const normalize = (list: readonly Iv[]): Iv[] => {
  const sorted = list.filter(([a, b]) => b >= a - TOL).sort((p, q) => p[0] - q[0]);
  const out: Iv[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + TOL) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};

/** Every sum of one or more values drawn from `base`, up to `cap`. */
const sums = (base: readonly Iv[], cap: number): Iv[] => {
  let all = normalize(base);
  let current = all;
  while (current.length) {
    const next: Iv[] = [];
    for (const [a, b] of current) for (const [c, d] of base) if (a + c <= cap) next.push([a + c, Math.min(b + d, cap)]);
    current = normalize(next);
    const merged = normalize([...all, ...current]);
    // A sum that adds nothing new adds nothing new after it either.
    if (merged.length === all.length && merged.every((iv, i) => iv[0] === all[i]![0] && iv[1] === all[i]![1])) break;
    all = merged;
  }
  return all;
};

const has = (set: readonly Iv[], value: number) => set.some(([a, b]) => value >= a - TOL && value <= b + TOL);

const intersect = (a: readonly Iv[], b: readonly Iv[]): Iv[] => {
  const out: Iv[] = [];
  for (const [p, q] of a) for (const [r, s] of b) {
    const lo = Math.max(p, r);
    const hi = Math.min(q, s);
    if (hi >= lo - TOL) out.push([lo, Math.max(lo, hi)]);
  }
  return normalize(out);
};

/** Values v with `total - v` in `set`. */
const complement = (set: readonly Iv[], total: number): Iv[] => normalize(set.map(([a, b]) => [total - b, total - a]));

const nearest = (set: readonly Iv[], target: number): number | undefined => {
  let best: number | undefined;
  for (const [a, b] of set) {
    const v = Math.min(b, Math.max(a, target));
    if (best === undefined || Math.abs(v - target) < Math.abs(best - target)) best = v;
  }
  return best;
};

/** The smallest value of `set` at least `min`. */
const atLeast = (set: readonly Iv[], min: number): number | undefined => {
  for (const [a, b] of set) if (b >= min - TOL) return Math.max(a, min);
  return undefined;
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const mod = (value: number, size: number) => ((value % size) + size) % size;

interface Type {
  card: MosaicCard;
  /** The caption's share of the footprint's height. */
  cap: number;
  /** Inflated width range. */
  lo: number;
  pref: number;
  hi: number;
  /** Body height bounds at a card width, never below the measured content. */
  bodyAt(width: number): [number, number];
}

const prepare = (card: MosaicCard, gap: readonly [number, number]): Type => {
  const samples = [...(card.floor ?? [])].sort((a, b) => a.width - b.width);
  const floorAt = (width: number) => {
    if (!samples.length) return 0;
    if (width <= samples[0]!.width) return samples[0]!.minHeight;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (width <= b.width) return a.minHeight + ((b.minHeight - a.minHeight) * (width - a.width)) / Math.max(TOL, b.width - a.width);
    }
    return samples[samples.length - 1]!.minHeight;
  };
  const cap = card.caption.height > 0 ? card.caption.gap + card.caption.height : 0;
  return {
    card,
    cap,
    lo: card.width.min + gap[0],
    pref: card.width.pref + gap[0],
    hi: card.width.max + gap[0],
    bodyAt(width) {
      const floor = floorAt(width);
      return [Math.max(card.height.min, floor), Math.max(card.height.max, floor)];
    },
  };
};

interface Segment {
  x: number;
  w: number;
  /** Depth of the front here: world y going down, minus world y going up. */
  d: number;
  /** The patterns whose edges form it, so neighbours can differ. */
  keys: string[];
}

export function createMosaic(catalog: readonly MosaicCard[], options: MosaicOptions): Mosaic {
  const gap = options.gap;
  const [gx, gy] = gap;
  const random = mulberry32(options.seed ?? 271828);
  const types = catalog.map((card) => prepare(card, gap));
  if (!types.length) throw new Error('A mosaic needs at least one card.');
  const widest = Math.max(...types.map((t) => t.hi));
  // Inflated footprint heights a card of the type can take at any width in its range.
  const heightRange = (t: Type, width: number): Iv => {
    const [lo, hi] = t.bodyAt(width - gx);
    return [lo + t.cap + gy, hi + t.cap + gy];
  };
  const tallest = Math.max(...types.map((t) => heightRange(t, t.lo)[1]));
  const heights = types.map((t) => heightRange(t, t.pref)[0]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)]!;

  // Widths any run of cards can fill exactly, and the zero a finished stretch leaves.
  const widthBase = normalize(types.map((t) => [t.lo, t.hi]));
  const widthCap = options.period * 2 + widest * 6;
  const F = sums(widthBase, widthCap);
  const F0 = normalize([[0, 0], ...F]);
  // Stack depths are needed as far as the deepest landing.
  const heightCap = Math.max(options.landingDepth ?? 0, median) * 2 + tallest * 12;

  const items: MosaicItem[] = [];
  const buckets = new Map<number, number[]>();
  const BUCKET = 512;
  let violations = 0;

  // Prefers types in a shuffled order, a fresh order each time the bag runs low; every type is
  // still offered after the bag's.
  let bag: number[] = [];
  const order = () => {
    if (bag.length < types.length) {
      const next = types.map((_, i) => i);
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
      bag = [...bag, ...next];
    }
    const listed = new Set(bag);
    return [...bag, ...types.map((_, i) => i).filter((i) => !listed.has(i))];
  };
  const used = (index: number) => {
    const at = bag.indexOf(index);
    if (at >= 0) bag.splice(at, 1);
  };

  const add = (t: Type, X: number, Y: number, W: number, H: number, role?: MosaicItem['role']) => {
    const w = W - gx;
    const h = H - gy;
    const body = h - t.cap;
    const [lo, hi] = t.bodyAt(w);
    if (w < t.card.width.min - 0.5 || w > t.card.width.max + 0.5 || body < lo - 0.5 || (body > hi + 0.5 && role !== 'hero')) violations++;
    const captionWidth = Math.min(w, t.card.caption.width);
    const item: MosaicItem = {
      pattern: t.card.key,
      x: X + gx / 2,
      y: Y + gy / 2,
      w,
      h,
      card: { x: 0, y: 0, w, h: body },
      caption: t.cap ? { x: (w - captionWidth) / 2, y: body + t.card.caption.gap, w: captionWidth, h: t.card.caption.height } : { x: 0, y: 0, w: 0, h: 0 },
      role,
    };
    const index = items.push(item) - 1;
    for (let b = Math.floor(item.y / BUCKET); b <= Math.floor((item.y + item.h) / BUCKET); b++) {
      const list = buckets.get(b);
      if (list) list.push(index);
      else buckets.set(b, [index]);
    }
    return index;
  };

  /** The patterns of cards whose edges touch the vertical line `x` over depths [d0, d1]. */
  const along = (x: number, d0: number, d1: number, sign: 1 | -1, into: Set<string>) => {
    const y0 = sign > 0 ? d0 : -d1;
    const y1 = sign > 0 ? d1 : -d0;
    for (let b = Math.floor((y0 - gy) / BUCKET); b <= Math.floor((y1 + gy) / BUCKET); b++) {
      for (const index of buckets.get(b) ?? []) {
        const item = items[index]!;
        if (item.y - gy / 2 >= y1 - TOL || item.y + item.h + gy / 2 <= y0 + TOL) continue;
        const left = mod(item.x - gx / 2 - x + period / 2, period) - period / 2;
        const right = mod(item.x + item.w + gx / 2 - x + period / 2, period) - period / 2;
        if (Math.abs(left) < 0.5 || Math.abs(right) < 0.5) into.add(item.pattern);
      }
    }
    return into;
  };

  /**
   * How many patterns could fill a rest of `width` on their own, or any of them when it takes two
   * or more cards: a rest only one narrow pattern fits would make that pattern the filler everywhere.
   */
  const twoCards = Math.min(...types.map((t) => t.lo)) * 2;
  const richness = (width: number) => {
    if (width < TOL || width >= twoCards) return 1;
    let fits = 0;
    for (const t of types) if (width >= t.lo - TOL && width <= t.hi + TOL) fits++;
    return fits / types.length;
  };
  /** Widths to try for a card in `options`: near `target`, and leaving widths many patterns fit. */
  const widthsFor = (options: readonly Iv[], target: number, remaining: number) => {
    const samples: number[] = [];
    for (const [a, b] of options) for (let i = 0; i <= 6; i++) samples.push(a + ((b - a) * i) / 6);
    const t = nearest(options, target)!;
    samples.push(t);
    const span = Math.max(1, ...options.map(([a, b]) => b - a));
    // The card's own width becomes a stretch of the front above it, refilled the same way.
    const score = (W: number) => Math.abs(W - target) / span + (1 - richness(remaining - W)) * 2 + (1 - richness(W)) * 2;
    return [...new Set(samples)].sort((a, b) => score(a) - score(b));
  };

  interface Choice {
    t: Type;
    index: number;
    W: number;
    H: number;
  }

  /**
   * A card for `remaining` width of a stretch at depth `d`: its width leaves a fillable rest, its
   * height prefers to meet one of `snaps`, and stays in `allowed` when given.
   */
  const choose = (remaining: number, d: number, avoid: ReadonlySet<string>, snaps: readonly number[], allowed?: readonly Iv[]): Choice => {
    const widths = complement(F0, remaining);
    // Height limits give way first (the landing depth then moves deeper), pattern variety next;
    // the widths, which keep every stretch fillable, never do.
    const passes = allowed
      ? [[true, allowed], [false, allowed], [true, undefined], [false, undefined]] as const
      : [[true, undefined], [false, undefined]] as const;
    for (const [strict, limit] of passes) {
      for (const index of order()) {
        const t = types[index]!;
        if (strict && avoid.has(t.card.key)) continue;
        const options = intersect([[t.lo, t.hi]], widths);
        if (!options.length) continue;
        const jitter = (random() * 2 - 1) * 0.8;
        const target = t.pref + jitter * (jitter < 0 ? t.pref - t.lo : t.hi - t.pref);
        const candidates = widthsFor(options, target, remaining);
        for (const W of candidates) {
          let range: Iv[] = [heightRange(t, W)];
          if (limit) range = intersect(range, limit);
          if (!range.length) continue;
          const [lo, hi] = heightRange(t, W);
          const preferred = Math.min(hi, Math.max(lo, t.card.height.pref + t.cap + gy + (random() * 2 - 1) * 0.3 * (hi - lo)));
          let H: number | undefined;
          for (const snap of snaps) {
            const candidate = snap - d;
            if (candidate > 0 && has(range, candidate) && (H === undefined || Math.abs(candidate - preferred) < Math.abs(H - preferred))) H = candidate;
          }
          H ??= nearest(range, preferred)!;
          used(index);
          return { t, index, W, H };
        }
      }
    }
    // Only a catalog whose ranges cannot add up gets here: keep going, outside the ranges.
    const t = types[0]!;
    violations++;
    const H = allowed ? (nearest(allowed, heightRange(t, t.pref)[0]) ?? heightRange(t, t.pref)[0]) : heightRange(t, t.pref)[0];
    return { t, index: 0, W: Math.min(remaining, t.pref), H };
  };

  const accepting = (width: number) => types.filter((t) => width >= t.lo - TOL && width <= t.hi + TOL);
  /** Depths a stack of single cards of `width` can add, card after card. */
  const stackCache = new Map<number, Iv[]>();
  const stackHeights = (width: number) => {
    const key = Math.round(width * 100);
    let set = stackCache.get(key);
    if (!set) {
      const base = normalize(accepting(width).map((t) => heightRange(t, width)));
      set = normalize([[0, 0], ...sums(base, heightCap)]);
      stackCache.set(key, set);
    }
    return set;
  };
  /** Widths exactly k cards side by side can take, for k = 0..4. */
  const exact: Iv[][] = [[[0, 0]], widthBase];
  for (let k = 2; k <= 4; k++) exact.push(normalize(exact[k - 1]!.flatMap(([a, b]) => widthBase.map(([c, d]): Iv => [a + c, b + d]))));
  const shift = (set: readonly Iv[], by: number): Iv[] => set.map(([a, b]) => [a + by, b + by]);
  /** `total` as `k` widths cards take, as even as they can be. */
  const decompose = (total: number, k: number): number[] | undefined => {
    const out: number[] = [];
    let rest = total;
    for (let i = k; i > 1; i--) {
      const w = nearest(intersect(widthBase, complement(exact[i - 1]!, rest)), rest / i);
      if (w === undefined) return undefined;
      out.push(w);
      rest -= w;
    }
    if (!has(widthBase, rest)) return undefined;
    out.push(rest);
    return out;
  };
  /** A pattern that takes `width`, preferring one not in `avoid`. */
  const typeFor = (width: number, avoid: ReadonlySet<string>): Type => {
    for (const strict of [true, false]) {
      for (const index of order()) {
        const t = types[index]!;
        if (strict && avoid.has(t.card.key)) continue;
        if (width < t.lo - TOL || width > t.hi + TOL) continue;
        used(index);
        return t;
      }
    }
    violations++;
    return types[0]!;
  };

  // ---- The seed row: one chain of abutting cards round the period, the hero among them. ----

  interface Seeded {
    t: Type;
    X: number;
    Y: number;
    W: number;
    H: number;
    role?: MosaicItem['role'];
  }
  const seeds: Seeded[] = [];
  let heroBottom = 0;
  /** The opening's stack edges, left to right; the gutter, x = 0, is among them. */
  let bankEdges: number[] = [];
  let period: number;
  const hero = options.hero;
  const jagged = (H: number) => -H / 2 + (random() - 0.5) * H * 0.6;

  if (hero) {
    // The slot is a real card's, so once the hero docks (or in any other copy of the period) that
    // card takes it over: no gap is ever left to refill.
    const cost = (t: Type) => {
      const W = Math.min(t.hi, Math.max(t.lo, hero.width + gx));
      const [, hi] = heightRange(t, W);
      return Math.max(0, hero.height + gy - hi) * 4 + Math.abs(W - gx - hero.width) + Math.abs(heightRange(t, W)[0] - hero.height - gy) * 0.5;
    };
    const slot = [...types].sort((a, b) => cost(a) - cost(b))[0]!;
    const natural = Math.min(slot.hi, Math.max(slot.lo, hero.width + gx));
    // Under the hero, each side is a lane: its neighbours (one or two, ending at the hero's bottom)
    // plus half the hero. A lane runs down beside the gutter as stacks of single cards (the only
    // columns in the world), so it must split into widths cards take, and leave a fillable rest
    // beside a landing card of some width `Wl` centred on the gutter. The hero may widen within
    // its slot's range to make that possible.
    const prefs = types.map((t) => t.pref).sort((p, q) => p - q);
    const typical = prefs[Math.floor(prefs.length / 2)]!;
    const landings = types.flatMap((t) => [t.pref, (t.lo + t.pref) / 2, (t.pref + t.hi) / 2, t.lo, t.hi]);
    let plan: { W: number; lane: number; m: number; stacks: number[]; score: number } | undefined;
    for (const W of [0, 0.25, 0.5, 0.75, 1].map((f) => natural + (slot.hi - natural) * f)) {
      for (const m of [1, 2]) {
        for (const k of [1, 2, 3]) {
          const lanes = intersect(exact[k]!, shift(exact[m]!, W / 2));
          if (!lanes.length) continue;
          for (const Wl of landings) {
            const fits = intersect(lanes, shift(F0, Wl / 2));
            if (!fits.length) continue;
            const lane = nearest(fits, W / 2 + m * typical)!;
            const stacks = decompose(lane, k);
            if (!stacks) continue;
            const richness = Math.min(4, ...stacks.map((w) => accepting(w).length));
            const score = (m - 1) * 100 + Math.abs(W - natural) / 10 - richness * 20 + k;
            if (!plan || score < plan.score) plan = { W, lane, m, stacks, score };
            break;
          }
        }
      }
    }
    if (!plan) {
      // A catalog no planned opening fits: one neighbour and one stack a side, outside the ranges.
      violations++;
      plan = { W: natural, lane: natural / 2 + typical, m: 1, stacks: [natural / 2 + typical], score: 0 };
    }
    const W = plan.W;
    const [lo, hi] = heightRange(slot, W);
    const H = Math.max(lo, Math.min(hi, hero.height + gy), hero.height + gy);
    const X = -W / 2;
    const Y = -H / 2;
    heroBottom = Y + H;
    const neighbours = (side: -1 | 1, avoid: Set<string>): Seeded[] => {
      const widths = decompose(plan!.lane - W / 2, plan!.m) ?? [plan!.lane - W / 2];
      let x = side < 0 ? X : X + W;
      return widths.map((w) => {
        const t = typeFor(w, avoid);
        avoid.add(t.card.key);
        const [hlo, hhi] = heightRange(t, w);
        const h = Math.min(hhi, Math.max(hlo, t.card.height.pref + t.cap + gy));
        const seed = { t, X: side < 0 ? x - w : x, Y: heroBottom - h, W: w, H: h };
        x = side < 0 ? x - w : x + w;
        return seed;
      });
    };
    const leftSide = neighbours(-1, new Set([slot.card.key]));
    const rightSide = neighbours(1, new Set([slot.card.key, leftSide[0]!.t.card.key]));
    const left = leftSide[leftSide.length - 1]!;
    const right = rightSide[rightSide.length - 1]!;
    // The stacks' edges, from the left lane's outer edge to the right lane's, through the gutter.
    let edge = -plan.lane;
    bankEdges = [edge];
    for (const w of plan.stacks) bankEdges.push((edge += w));
    for (const w of [...plan.stacks].reverse()) bankEdges.push((edge += w));
    const fixed = plan.lane * 2;
    const rest = atLeast(F, Math.max(widest, options.period - fixed))!;
    period = fixed + rest;
    seeds.push(...[...leftSide].reverse(), { t: slot, X, Y, W, H, role: 'hero' }, ...rightSide);
    let x = right.X + right.W;
    let remaining = rest;
    let previous = right.t.card.key;
    while (remaining > TOL) {
      const avoid = new Set([previous]);
      if (remaining <= widest * 2) avoid.add(left.t.card.key);
      const c = choose(remaining, 0, avoid, []);
      seeds.push({ t: c.t, X: x, Y: jagged(c.H), W: c.W, H: c.H });
      x += c.W;
      remaining -= c.W;
      previous = c.t.card.key;
    }
  } else {
    period = atLeast(F, Math.max(widest, options.period))!;
    let x = -period / 2;
    let remaining = period;
    let previous = '';
    while (remaining > TOL) {
      const c = choose(remaining, 0, new Set([previous]), []);
      seeds.push({ t: c.t, X: x, Y: jagged(c.H), W: c.W, H: c.H });
      x += c.W;
      remaining -= c.W;
      previous = c.t.card.key;
    }
  }

  let heroIndex: number | undefined;
  for (const s of seeds) {
    const index = add(s.t, s.X, s.Y, s.W, s.H, s.role);
    if (s.role === 'hero') heroIndex = index;
  }

  const merge = (segments: Segment[], blocked: (x: number) => boolean = () => false) => {
    for (let i = 0; i < segments.length && segments.length > 1; ) {
      const a = segments[i]!;
      const j = (i + 1) % segments.length;
      const b = segments[j]!;
      if (Math.abs(a.d - b.d) < TOL && !blocked(a.x + a.w)) {
        b.d = a.d;
        if (j === 0) {
          // The last stretch runs on round the period into the first.
          a.w += b.w;
          a.keys.push(...b.keys);
          segments.shift();
        } else {
          a.w += b.w;
          a.keys.push(...b.keys);
          segments.splice(j, 1);
        }
        continue;
      }
      i++;
    }
  };

  const down: Segment[] = seeds.map((s) => ({ x: s.X, w: s.W, d: s.Y + s.H, keys: [s.t.card.key] }));
  const up: Segment[] = seeds.map((s) => ({ x: s.X, w: s.W, d: -s.Y, keys: [s.t.card.key] }));

  // ---- The opening: stacks either side of a clear gutter down x = 0, to the landing card. ----
  let barrierActive = !!hero;
  let landing: number | undefined;
  let landTarget = 0;
  let yLand = 0;
  /** x relative to the gutter, in (-period / 2, period / 2]. */
  const rel = (x: number) => mod(x + period / 2, period) - period / 2;
  let edges = bankEdges;
  const atBarrier = (x: number) => barrierActive && edges.some((e) => Math.abs(rel(x - e)) < TOL);
  /** Splits the front at every stack edge, where the stretches there share a depth. */
  const splitAtEdges = () => {
    for (const e of edges) {
      const i = down.findIndex((s) => {
        const at = mod(e - s.x, period);
        return at > TOL && at < s.w - TOL;
      });
      if (i < 0) continue;
      const s = down[i]!;
      const w = mod(e - s.x, period);
      down.splice(i, 1, { x: s.x, w, d: s.d, keys: [...s.keys] }, { x: s.x + w, w: s.w - w, d: s.d, keys: [...s.keys] });
    }
  };
  merge(up);
  merge(down);
  if (hero) {
    // The hero and its neighbours share a bottom: the stacks start there.
    splitAtEdges();
    landTarget = heroBottom + Math.max(median, options.landingDepth ?? median);
    yLand = landTarget;
  }
  const lanes = () => {
    const left = down.findIndex((s) => Math.abs(rel(s.x + s.w)) < TOL);
    const right = down.findIndex((s) => Math.abs(rel(s.x)) < TOL);
    return [left, right] as const;
  };
  const first = bankEdges[0] ?? 0;
  const last = bankEdges[bankEdges.length - 1] ?? 0;
  const inBank = (s: Segment) => barrierActive && rel(s.x) >= rel(first) - TOL && rel(s.x) + s.w <= rel(last) + TOL;
  const frozen = (s: Segment) => inBank(s) && Math.abs(s.d - yLand) < TOL;

  /** Keeps the landing depth reachable from every stack, deeper when it no longer is. */
  const realign = () => {
    const stacks = down.filter(inBank);
    const reachable = (y: number) => stacks.every((s) => has(stackHeights(s.w), y - s.d));
    if (yLand >= landTarget - TOL && reachable(yLand)) return;
    const min = Math.max(landTarget, ...stacks.map((s) => s.d));
    // The lowest such depth is where one stack's reach starts.
    const candidates = [min, ...stacks.flatMap((s) => stackHeights(s.w).map(([a]) => s.d + a))]
      .filter((y) => y >= min - TOL)
      .sort((p, q) => p - q);
    yLand = candidates.find(reachable) ?? min + median;
  };

  if (hero) realign();

  /** Puts the landing card centred over the gutter, once every stack has reached its depth. */
  const land = () => {
    if (down.some((s) => inBank(s) && !frozen(s))) return false;
    // The stacks of each lane become one stretch; the gutter and the lanes' outer edges hold.
    edges = [first, 0, last];
    merge(down, atBarrier);
    const [l, r] = lanes();
    const L = down[l]!;
    const R = down[r]!;
    const avoid = new Set([...L.keys, ...R.keys]);
    let best: { t: Type; index: number; W: number; p: number; score: number } | undefined;
    for (const strict of [true, false]) {
      for (const index of order()) {
        const t = types[index]!;
        if (strict && avoid.has(t.card.key)) continue;
        for (const W of [t.pref, t.lo, t.hi, (t.lo + t.pref) / 2, (t.pref + t.hi) / 2]) {
          // The landing's left edge, relative to the gutter: the card spans x = 0 with a margin either
          // side, centred when the lanes allow.
          const margin = Math.min(0.2 * (W - gx), 64);
          for (const [a, b] of F0) for (const [c, e] of F0) {
            const lo = Math.max(-L.w + a, R.w - W - e, margin - W + gx / 2);
            const hi = Math.min(-L.w + b, R.w - W - c, -margin - gx / 2);
            if (hi < lo - TOL) continue;
            const p = Math.min(hi, Math.max(lo, -W / 2));
            const score = Math.abs(p + W / 2) * 4 + Math.abs(W - t.pref);
            if (!best || score < best.score) best = { t, index, W, p, score };
          }
        }
      }
      if (best) break;
    }
    if (!best) {
      // Only an unplanned opening gets here: the stacks go on, a couple of cards deeper.
      edges = bankEdges;
      splitAtEdges();
      landTarget = yLand + median * 2;
      realign();
      return false;
    }
    const { t, W, p } = best;
    used(best.index);
    const [hlo, hhi] = heightRange(t, W);
    const H = Math.min(hhi, Math.max(hlo, t.card.height.pref + t.cap + gy));
    // The gutter's x in the front's own frame: the period may have wrapped it.
    const X0 = L.x + L.w;
    // The card itself is placed in the hero's copy of the period, right under it.
    landing = add(t, X0 - period * Math.round(X0 / period) + p, yLand, W, H, 'landing');
    barrierActive = false;
    const replaced: Segment[] = [];
    if (L.w + p > TOL) replaced.push({ x: L.x, w: L.w + p, d: yLand, keys: [...L.keys] });
    replaced.push({ x: X0 + p, w: W, d: yLand + H, keys: [t.card.key] });
    if (R.w - p - W > TOL) replaced.push({ x: X0 + p + W, w: R.w - p - W, d: yLand, keys: [...R.keys] });
    if (r === l + 1) down.splice(l, 2, ...replaced);
    else {
      // The two lanes sit either end of the array, the gutter at the seam.
      down.splice(r, 1);
      down.splice(down.length - 1, 1, ...replaced);
    }
    merge(down);
    return true;
  };

  /** Fills the lowest stretch of a front completely. */
  const step = (front: Segment[], sign: 1 | -1) => {
    let i = -1;
    for (let j = 0; j < front.length; j++) {
      const s = front[j]!;
      if (sign > 0 && frozen(s)) continue;
      if (i < 0 || s.d < front[i]!.d - TOL) i = j;
    }
    if (i < 0) return;
    const s = front[i]!;
    const before = front[(i - 1 + front.length) % front.length]!;
    const after = front[(i + 1) % front.length]!;
    // Next to the opening gutter, start from the gutter. In a stack beside it, every card keeps the
    // landing depth reachable, and reaches it when it can.
    const fromRight = sign > 0 && atBarrier(s.x + s.w) ? true : sign > 0 && atBarrier(s.x) ? false : random() < 0.5;
    const constrained = sign > 0 && inBank(s);
    const placed: { X: number; W: number; d: number; key: string }[] = [];
    let remaining = s.w;
    let previous: { d: number; key: string } | undefined;
    const outer = fromRight ? after : before;
    const far = fromRight ? before : after;
    while (remaining > TOL) {
      const first = !placed.length;
      const avoid = new Set<string>([...s.keys]);
      const snaps: number[] = [];
      const start = fromRight ? s.x + remaining : s.x + s.w - remaining;
      if (first) {
        if (outer !== s) {
          along(start, s.d, s.d + tallest, sign, avoid);
          snaps.push(outer.d);
        }
      } else if (previous) {
        avoid.add(previous.key);
        snaps.push(previous.d);
      }
      if (far !== s && remaining <= widest) {
        along(fromRight ? s.x : s.x + s.w, s.d, s.d + tallest, sign, avoid);
        snaps.push(far.d);
      }
      if (constrained) snaps.push(yLand);
      const allowed = constrained ? intersect([[0, Infinity]], complement(stackHeights(s.w), yLand - s.d)) : undefined;
      const c = choose(remaining, s.d, avoid, snaps, allowed);
      const W = Math.min(c.W, remaining);
      const X = fromRight ? s.x + remaining - W : s.x + s.w - remaining;
      add(c.t, X, sign > 0 ? s.d : -(s.d + c.H), W, c.H);
      placed.push({ X, W, d: s.d + c.H, key: c.t.card.key });
      previous = { d: s.d + c.H, key: c.t.card.key };
      remaining -= W;
    }
    placed.sort((a, b) => a.X - b.X);
    front.splice(i, 1, ...placed.map((p) => ({ x: p.X, w: p.W, d: p.d, keys: [p.key] })));
    merge(front, sign > 0 ? atBarrier : undefined);
    if (sign > 0 && barrierActive) {
      realign();
      land();
    }
  };

  const lowest = (front: Segment[]) => front.reduce((min, s) => Math.min(min, s.d), Infinity);
  const ensure = (top: number, bottom: number) => {
    // Inflated depths: a front at depth d has every card above (or below) it in place.
    for (let guard = 0; lowest(down) < bottom + gy && guard < 100000; guard++) step(down, 1);
    for (let guard = 0; lowest(up) < -top + gy && guard < 100000; guard++) step(up, -1);
  };

  let stamp = 0;
  const seen: number[] = [];
  const query = (box: Box, visit: (index: number, k: number) => void) => {
    ensure(box.y, box.y + box.h);
    stamp++;
    for (let b = Math.floor(box.y / BUCKET); b <= Math.floor((box.y + box.h) / BUCKET); b++) {
      for (const index of buckets.get(b) ?? []) {
        if (seen[index] === stamp) continue;
        seen[index] = stamp;
        const item = items[index]!;
        if (item.y >= box.y + box.h || item.y + item.h <= box.y) continue;
        const first = Math.ceil((box.x - item.x - item.w) / period);
        const last = Math.floor((box.x + box.w - item.x) / period);
        for (let k = first; k <= last; k++) {
          const x = item.x + k * period;
          if (x < box.x + box.w && x + item.w > box.x) visit(index, k);
        }
      }
    }
  };

  return {
    items,
    period,
    hero: heroIndex,
    get landing() {
      if (hero && landing === undefined) {
        for (let guard = 0; landing === undefined && guard < 100000; guard++) step(down, 1);
      }
      return landing;
    },
    ensure,
    query,
    get violations() {
      return violations;
    },
  };
}
