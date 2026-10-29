/*
 * The stage scene: the layout of what is drawn over a stage, published once by whichever
 * component lays it out and read by every effect behind it, so effects never query the DOM for
 * positions. Positions are in CSS pixels of the stage, +Y down, already wrapped onto the stage, so
 * a layer's unbounded pan offset never reaches a consumer: it publishes `pan` separately, and
 * consumers derive its velocity from how `pan` changes. The scene also orders the stage's
 * animation frames: the layout runs first, then the effects drawn from it, so they never trail it
 * by a frame, whichever loop started first.
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

export interface SceneUpdate {
  /** The stage's size, in CSS pixels. */
  size?: readonly [number, number];
  /** The stage's left and top in the viewport. */
  origin?: readonly [number, number];
  /** The rigid offset of the layer; its change over time is the layer's velocity. */
  pan?: readonly [number, number];
  /** The solids on the stage; off-stage ones are left out by the publisher. */
  rects?: readonly SceneRect[];
}

export interface Scene {
  readonly size: readonly [number, number];
  readonly origin: readonly [number, number];
  readonly pan: readonly [number, number];
  readonly rects: readonly SceneRect[];
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
    version: 0,
    publish(update: SceneUpdate) {
      if (update.size) scene.size = update.size;
      if (update.origin) scene.origin = update.origin;
      if (update.pan) scene.pan = update.pan;
      if (update.rects) scene.rects = update.rects;
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
