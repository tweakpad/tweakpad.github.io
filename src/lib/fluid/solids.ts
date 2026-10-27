/*
 * Walls for the fluid, from the stage scene: the rounded rectangles the scene publishes are packed
 * for the raster pass (solids.wgsl), and the layer's velocity comes from how its pan changes, so
 * the fluid is pushed when the cards move. Nothing here reads the DOM.
 */
import type { Scene } from '../scene';
import { MAX_WALLS, type Wall, type Walls } from './simulation';

/** The solver's speed cap, in stage fractions per second. */
const MAX_SPEED = 2.5;

export interface WallTracker {
  /** The walls for the next step; `dt` is the time since the previous call, in seconds. */
  update(dt: number): Walls;
}

export function trackWalls(scene: Scene): WallTracker {
  // The uniform array is always full; walls past `count` are never drawn.
  const rects: Wall[] = Array.from({ length: MAX_WALLS }, () => ({ rect: [0, 0, 0, 0], radius: 0 }));
  const walls: Walls = { size: [1, 1], velocity: [0, 0], count: 0, rects, version: -1 };
  let lastPan = scene.pan;
  let packedVersion = -1;

  const update = (dt: number): Walls => {
    const [width, height] = scene.size;
    walls.size = [Math.max(1, width), Math.max(1, height)];

    // The whole layer moves together, so one velocity serves every wall.
    const pan = scene.pan;
    let vx = 0;
    let vy = 0;
    if (dt > 0 && pan !== lastPan) {
      vx = (pan[0] - lastPan[0]) / dt / walls.size[0];
      vy = -(pan[1] - lastPan[1]) / dt / walls.size[1];
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_SPEED) {
        vx *= MAX_SPEED / speed;
        vy *= MAX_SPEED / speed;
      }
    }
    lastPan = pan;
    walls.velocity = [vx, vy];

    if (scene.version !== packedVersion) {
      packedVersion = scene.version;
      const count = Math.min(MAX_WALLS, scene.rects.length);
      for (let i = 0; i < count; i += 1) {
        const from = scene.rects[i]!;
        const to = rects[i]!;
        to.rect[0] = from.x;
        to.rect[1] = from.y;
        to.rect[2] = from.w;
        to.rect[3] = from.h;
        to.radius = from.r;
      }
      walls.count = count;
      walls.version = packedVersion;
    }
    return walls;
  };

  return { update };
}
