/*
 * Walls for the fluid, from the stage scene: the rounded rectangles the scene publishes are packed
 * for the raster pass (solids.wgsl), and the layer's velocity comes from how its pan changes, so
 * the fluid is pushed when the cards move. A rect's lift decides how solid its wall is: as faint as
 * the resting strength says while the card rests, whole once it has risen. Nothing here reads the
 * DOM.
 */
import type { Scene } from '../scene';
import { MAX_WALLS, type Wall, type Walls } from './simulation';

/** The solver's speed cap, in stage fractions per second. */
const MAX_SPEED = 2.5;
/**
 * The layer's velocity is smoothed over about this long, in seconds: the pan can change once,
 * twice or not at all between two frames, and the water's light follows the cards' speed.
 */
const SMOOTHING = 0.06;

export interface WallTracker {
  /**
   * The walls as they are now; `dt` is the time since the previous call, in seconds, and `resting`
   * a resting card's strength as a wall, 0..1.
   */
  update(dt: number, resting: number): Walls;
}

export function trackWalls(scene: Scene): WallTracker {
  // The uniform array is always full; walls past `count` are never drawn.
  const rects: Wall[] = Array.from({ length: MAX_WALLS }, () => ({
    rect: [0, 0, 0, 0],
    radius: 0,
    strength: 0,
    swell: 0,
    lift: 0,
  }));
  const walls: Walls = { size: [1, 1], velocity: [0, 0], count: 0, rects, version: -1 };
  let lastPan = scene.pan;
  let packedVersion = -1;
  let packedResting = Number.NaN;

  const update = (dt: number, resting: number): Walls => {
    const [width, height] = scene.size;
    walls.size = [Math.max(1, width), Math.max(1, height)];

    // The whole layer moves together, so one velocity serves every wall.
    const pan = scene.pan;
    if (dt > 0) {
      let vx = 0;
      let vy = 0;
      if (pan !== lastPan) {
        vx = (pan[0] - lastPan[0]) / dt / walls.size[0];
        vy = -(pan[1] - lastPan[1]) / dt / walls.size[1];
        const speed = Math.hypot(vx, vy);
        if (speed > MAX_SPEED) {
          vx *= MAX_SPEED / speed;
          vy *= MAX_SPEED / speed;
        }
      }
      const blend = 1 - Math.exp(-dt / SMOOTHING);
      const [sx, sy] = walls.velocity;
      walls.velocity = [sx + (vx - sx) * blend, sy + (vy - sy) * blend];
    } else {
      walls.velocity = [0, 0];
    }
    lastPan = pan;

    if (scene.version !== packedVersion || resting !== packedResting) {
      packedVersion = scene.version;
      packedResting = resting;
      const count = Math.min(MAX_WALLS, scene.rects.length);
      for (let i = 0; i < count; i += 1) {
        const from = scene.rects[i]!;
        const to = rects[i]!;
        to.rect[0] = from.x;
        to.rect[1] = from.y;
        to.rect[2] = from.w;
        to.rect[3] = from.h;
        to.radius = from.r;
        to.strength = resting + (1 - resting) * from.lift;
        to.swell = from.rise;
        to.lift = from.lift;
      }
      walls.count = count;
      walls.version += 1;
    }
    return walls;
  };

  return { update };
}
