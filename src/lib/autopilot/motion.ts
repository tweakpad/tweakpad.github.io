/*
 * How the trail head and the camera move. The head rides the path (path.ts) itself, carried by a
 * carrot whose speed eases in, slows for every corner, then winds up, easing down before the
 * final straight run, and bursts along the whole of it, so the head strikes the card rather than
 * settling on it, and the jump in speed has time to show. The camera is a flyby-motion Agent,
 * pulled by a spring toward a target that moves, damped, and stepped in small fixed sub-steps
 * (flyby's `step` is a plain semi-implicit Euler step, which a long frame would throw off).
 * Springs are set by their frequency ω and damping ratio ζ: stiffness ω² inside a reach, a
 * constant pull beyond it, and damping 2ζω; the reach is wide enough that the pull outruns the
 * target, so the agent never falls further and further behind. The camera follows the head,
 * aiming ahead of it by a share of its own lag, and turns to the card once the head strikes it,
 * with a softer spring that swings a little past it, then wanders around it like a handheld
 * camera.
 */
import { Agent, forces, step, type Force } from 'flyby-motion';

import type { Point } from './model';
import { sampleAt, type Path } from './path';

/** Sub-steps per second: short enough for the stiffest spring the panel allows. */
const SUBSTEPS = 120;

/** The damping ratio that overshoots by `share` (0..1) of the distance. */
export const dampingFor = (share: number) => {
  const p = Math.min(0.9, Math.max(1e-4, share));
  const log = Math.log(p);
  return -log / Math.sqrt(Math.PI * Math.PI + log * log);
};

export const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export interface SpeedOptions {
  /** Along the straight runs, px/s, and how quickly it gets there, px/s². */
  speed: number;
  acceleration: number;
  /** The corner speed is √(cornering × radius). */
  cornering: number;
  /**
   * The burst into the card, from arc length `from` on: the head winds up to `windup` × `speed`
   * there, then speeds up evenly to `speed` × `impact` at the card.
   */
  finish: { from: number; windup: number; impact: number };
}

/** Where the burst begins: `runUp` before the card, but never before the final straight run. */
export const burstFrom = (path: Path, runUp: number) =>
  Math.min(path.length, Math.max(path.straightFrom, path.length - runUp));

/**
 * The carrot's speed at each sample, starting from `start`: its speed on the straight runs and
 * the corner limit, no faster than it can speed up or slow down for them, down to its wind-up
 * where the burst begins; then the burst, at the one acceleration that takes it from there to its
 * impact speed at the card. Spread over the whole run-up, the jump lasts as long as it can: the
 * run-up over the mean of the two speeds.
 */
export function speedProfile(path: Path, options: SpeedOptions, start: number): Float64Array {
  const n = path.s.length;
  const v = new Float64Array(n);
  const { from, windup, impact } = options.finish;
  let first = sampleAt(path, from);
  if (path.s[first]! < from) first = Math.min(n - 1, first + 1);
  const span = path.length - path.s[first]!;
  // Without a run-up there is no burst, and nothing to wind up for.
  const bursts = span >= 1;
  for (let i = 0; i < n; i += 1) {
    v[i] = Math.min(options.speed, Math.sqrt(options.cornering * path.radius[i]!));
    if (bursts && i === first) v[i] = Math.min(v[i]!, options.speed * Math.min(1, windup));
  }
  v[0] = Math.min(v[0]!, start);
  const last = bursts ? first : n - 1;
  for (let i = 1; i <= last; i += 1) {
    const ds = path.s[i]! - path.s[i - 1]!;
    v[i] = Math.min(v[i]!, Math.sqrt(v[i - 1]! ** 2 + 2 * options.acceleration * ds));
  }
  for (let i = last - 1; i >= 0; i -= 1) {
    const ds = path.s[i + 1]! - path.s[i]!;
    v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! ** 2 + 2 * options.acceleration * ds));
  }
  if (bursts) {
    // An even acceleration: the square of the speed grows with the distance.
    const low = v[first]!;
    const top = Math.max(low, options.speed * impact);
    for (let i = first + 1; i < n; i += 1) {
      v[i] = Math.sqrt(low * low + (top * top - low * low) * ((path.s[i]! - path.s[first]!) / span));
    }
  }
  return v;
}

/** The profile's speed at arc length `at`, never quite zero; past the end, its last speed. */
export function speedAt(path: Path, profile: Float64Array, at: number) {
  return Math.max(24, profile[Math.min(profile.length - 1, sampleAt(path, at))]!);
}

export interface Spring {
  /** Its frequency, rad/s, and damping ratio. */
  frequency: number;
  damping: number;
  /** How far the spring stays linear; beyond, the pull is constant. */
  reach: number;
}

/**
 * A spring with damping toward `target`, read live from `spring()`, so the panel can change it
 * while it runs. Built from flyby's attract, plus a damping that reads its ratio live.
 */
function springForces(target: () => number[], spring: () => Spring): Force[] {
  const pull = forces.attract(target, (distance) => {
    const { frequency, reach } = spring();
    return frequency * frequency * Math.min(distance, reach);
  });
  const damp: Force = (agent) => {
    const { frequency, damping } = spring();
    const c = 2 * damping * frequency;
    return agent.velocity.map((v) => -c * v);
  };
  return [pull, damp];
}

/** An agent with its spring, and the forces it adds besides. */
export class Mover {
  readonly agent = new Agent({ position: [0, 0], velocity: [0, 0] });
  private time = 0;

  constructor(target: () => number[], spring: () => Spring) {
    for (const force of springForces(target, spring)) this.agent.add(force);
  }

  get position(): Point {
    return this.agent.position as unknown as Point;
  }

  get velocity(): Point {
    return this.agent.velocity as unknown as Point;
  }

  place(position: Point, velocity: Point = [0, 0]) {
    this.agent.position = [position[0], position[1]];
    this.agent.velocity = [velocity[0], velocity[1]];
  }

  /** Advances `dt` seconds in sub-steps. */
  advance(dt: number) {
    if (dt <= 0) return;
    const count = Math.ceil(dt * SUBSTEPS);
    const h = dt / count;
    for (let i = 0; i < count; i += 1) {
      this.time += h;
      step(this.agent, {}, this.time, h);
    }
  }
}

/**
 * The handheld drift: flyby's Perlin drift, scaled live by `weight()`. Perlin noise is zero at
 * whole numbers, so the axes run at different rates from fractional seeds, never still together.
 * Built again when its strength or rate changes, as flyby bakes them in.
 */
export function handheld(strength: number, rate: number, weight: () => number): Force {
  const noise = forces.drift({
    x: { strength, scale: Math.max(0.01, rate), seed: 0.37 },
    y: { strength, scale: Math.max(0.01, rate * 0.79), seed: 1000.61 },
  });
  return (agent, world, t, dt) => {
    const w = weight();
    return w > 0 ? noise(agent, world, t, dt).map((v) => v * w) : [0, 0];
  };
}
