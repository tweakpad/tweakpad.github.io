/*
 * The stage scene: the layout of what is drawn over a stage, published once by whichever
 * component lays it out and read by every effect behind it, so effects never query the DOM for
 * positions. Positions are in CSS pixels of the stage, +Y down, already wrapped onto the stage, so
 * a layer's unbounded pan offset never reaches a consumer: it publishes `pan` separately, and
 * consumers derive its velocity from how `pan` changes. Alongside, the publisher describes the
 * unwrapped world it draws from (`layout`), where stage = world + pan, for anything that plans in
 * it, like the autopilot, which can fly the layer as its `pilot`. The scene also orders the
 * stage's animation frames: the layout runs first, then the effects drawn from it, so they never
 * trail it by a frame, whichever loop started first.
 */

/** The parts of a stage's animation frame, in the order they run. */
export type FramePhase = 'layout' | 'draw';

/** A solid shape over the stage: a rounded rectangle, in stage pixels. */
export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The corner radius, in pixels. */
  r: number;
  /** How far it has risen through a surface over the stage, 0 (submerged) to 1 (lifted). */
  lift: number;
  /** How fast it is rising right now, 0 to 1; 0 while steady or sinking. */
  rise: number;
}

/** A rectangle, in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One composition in a column of the world, its boxes relative to the item's top-left. */
export interface WorldItem {
  /** Its place in the column, from the top. */
  row: number;
  /** The pattern it shows; copies of a pattern share it. */
  pattern: string;
  /** Its top in the column, before the column's phase. */
  y: number;
  height: number;
  card: Box;
  caption: Box;
}

export interface WorldColumn {
  /** The column's vertical offset in the world; the column repeats every `height`. */
  phase: number;
  /** The column's period: its items and their gaps. */
  height: number;
  items: readonly WorldItem[];
}

/**
 * The world the layer draws from, unwrapped: column `u` (any integer) is column `mod(u, columns)`
 * at x = offsetX + u × (columnWidth + gap x), and its items repeat down the column every
 * `height`. Stage = world + pan.
 */
export interface WorldLayout {
  /** Changes on every relayout; `build` changes when the columns themselves are dealt again. */
  version: number;
  build: number;
  columnWidth: number;
  /** The gaps between columns and between the items of a column. */
  gap: readonly [number, number];
  offsetX: number;
  columns: readonly WorldColumn[];
}

/** Why the visitor took the layer back from a pilot. */
export type Interrupt = 'drag' | 'wheel' | 'key' | 'focus' | 'hover';

/** Flies the layer: while it is active, it sets the pan in place of the layer's own motion. */
export interface Pilot {
  readonly active: boolean;
  /**
   * Advances by `dt` seconds, every frame, from the current pan and the layer's velocity (stage
   * px per second). Returns the pan to show, or undefined while it holds off.
   */
  update(
    dt: number,
    pan: readonly [number, number],
    velocity: readonly [number, number],
  ): readonly [number, number] | undefined;
  /** The card it shows lifted, as the column and row of the world. */
  readonly featured: { column: number; row: number } | undefined;
  /** The visitor took over; the pilot holds off until they have been idle a while. */
  interrupt(reason: Interrupt): void;
}

/**
 * A second pointer in the water, along its last step, in stage pixels: it stirs as the pointer
 * does, with the pointer's settings, through water that keeps to `carry` as firmly as `grip` says.
 */
export interface SceneStir {
  /** How hard it stirs now: 1 as hard as the pointer, 0 not at all. */
  strength: number;
  from: readonly [number, number];
  to: readonly [number, number];
  /** Its velocity through the water around it, in stage px per second. */
  velocity: readonly [number, number];
  /** The velocity of that water, in stage px per second. */
  carry: readonly [number, number];
  /** How much of the way to `carry` the water at its centre goes each step, 0 to 1. */
  grip: number;
}

export interface SceneUpdate {
  /** The stage's size, in CSS pixels. */
  size?: readonly [number, number];
  /** The stage's left and top in the viewport. */
  origin?: readonly [number, number];
  /** The rigid offset of the layer; its change over time is the layer's velocity. */
  pan?: readonly [number, number];
  /** The solids on the stage; off-stage ones are left out by the publisher. */
  rects?: readonly SceneRect[];
  /** The unwrapped world the layer draws from. */
  layout?: WorldLayout;
  /** The part of the stage covered by page chrome: its top and left, in CSS pixels. */
  inset?: readonly [number, number];
  /** Who flies the layer, or null for no one. */
  pilot?: Pilot | null;
  /** A stir in the water besides the pointer's, or null for none. */
  stir?: SceneStir | null;
}

export interface Scene {
  readonly size: readonly [number, number];
  readonly origin: readonly [number, number];
  readonly pan: readonly [number, number];
  readonly rects: readonly SceneRect[];
  readonly layout: WorldLayout | undefined;
  readonly inset: readonly [number, number];
  readonly pilot: Pilot | undefined;
  readonly stir: SceneStir | undefined;
  /** Counts publishes, so a consumer can tell whether anything changed since it last looked. */
  readonly version: number;
  publish(update: SceneUpdate): void;
  /** Calls `listener` after every publish; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Calls `callback` on the next animation frame, in `phase`: every layout callback runs before
   * any draw callback that frame. A callback that asks again from inside the frame gets the next
   * one. Returns the request's cancellation.
   */
  requestFrame(callback: FrameRequestCallback, phase: FramePhase): () => void;
}

const scenes = new WeakMap<Element, Scene>();

function createScene(): Scene {
  const listeners = new Set<() => void>();
  const queues: Record<FramePhase, Set<FrameRequestCallback>> = { layout: new Set(), draw: new Set() };
  let scheduled = 0;
  const flush = (now: number) => {
    scheduled = 0;
    for (const phase of ['layout', 'draw'] as const) {
      // Taken as the phase starts, so a draw asked for during the layout still runs this frame.
      const due = [...queues[phase]];
      queues[phase].clear();
      for (const callback of due) {
        try {
          callback(now);
        } catch (error) {
          // One failing callback must not starve the rest, as with requestAnimationFrame itself.
          reportError(error);
        }
      }
    }
  };
  const scene = {
    size: [0, 0] as readonly [number, number],
    origin: [0, 0] as readonly [number, number],
    pan: [0, 0] as readonly [number, number],
    rects: [] as readonly SceneRect[],
    layout: undefined as WorldLayout | undefined,
    inset: [0, 0] as readonly [number, number],
    pilot: undefined as Pilot | undefined,
    stir: undefined as SceneStir | undefined,
    version: 0,
    publish(update: SceneUpdate) {
      if (update.size) scene.size = update.size;
      if (update.origin) scene.origin = update.origin;
      if (update.pan) scene.pan = update.pan;
      if (update.rects) scene.rects = update.rects;
      if (update.layout) scene.layout = update.layout;
      if (update.inset) scene.inset = update.inset;
      if (update.pilot !== undefined) scene.pilot = update.pilot ?? undefined;
      if (update.stir !== undefined) scene.stir = update.stir ?? undefined;
      scene.version += 1;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    requestFrame(callback: FrameRequestCallback, phase: FramePhase) {
      queues[phase].add(callback);
      if (!scheduled) scheduled = requestAnimationFrame(flush);
      return () => {
        queues[phase].delete(callback);
      };
    },
  };
  return scene;
}

/** The scene of `stage`, created on first use; components sharing a stage share its scene. */
export function sceneOf(stage: Element): Scene {
  let scene = scenes.get(stage);
  if (!scene) {
    scene = createScene();
    scenes.set(stage, scene);
  }
  return scene;
}
