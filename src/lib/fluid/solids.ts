/*
 * Walls for the fluid: elements laid over the canvas become solid cells, each carrying the
 * element's velocity, so the fluid flows around them and is pushed when they move.
 */
import type { SolidCells } from './simulation';

/** Velocities are in canvas widths/heights per second, like the solver's; this is its cap. */
const MAX_SPEED = 2.5;

interface Tracked {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export interface Solids {
  /** Reads the elements' current positions; `dt` is the time since the previous reading, in seconds. */
  update(dt: number): void;
  /** Fills solid cells for the positions last read; for `stepFluid`. */
  cells: SolidCells;
}

/** Tracks `elements()` over `canvas`; positions are in the canvas's fraction units, +Y up. */
export function trackSolids(canvas: HTMLElement, elements: () => Iterable<Element>): Solids {
  const previous = new Map<Element, Tracked>();
  let current: Tracked[] = [];
  let data = new Float32Array(new ArrayBuffer(0));

  const update = (dt: number) => {
    const frame = canvas.getBoundingClientRect();
    const w = Math.max(1, frame.width);
    const h = Math.max(1, frame.height);
    const seen = new Set<Element>();
    current = [];
    for (const element of elements()) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right < frame.left || box.left > frame.right) continue;
      if (box.bottom < frame.top || box.top > frame.bottom) continue;
      const x = (box.left - frame.left) / w;
      const y = 1 - (box.bottom - frame.top) / h;
      const last = previous.get(element);
      let vx = 0;
      let vy = 0;
      if (last && dt > 0) {
        vx = (x - last.x) / dt;
        vy = (y - last.y) / dt;
        const speed = Math.hypot(vx, vy);
        if (speed > MAX_SPEED) {
          vx *= MAX_SPEED / speed;
          vy *= MAX_SPEED / speed;
        }
      }
      const tracked = { x, y, w: box.width / w, h: box.height / h, vx, vy };
      previous.set(element, tracked);
      seen.add(element);
      current.push(tracked);
    }
    for (const element of previous.keys()) {
      if (!seen.has(element)) previous.delete(element);
    }
  };

  const cells: SolidCells = (grid) => {
    const [gx, gy] = grid;
    const length = gx * gy * 4;
    if (data.length !== length) data = new Float32Array(new ArrayBuffer(length * 4));
    else data.fill(0);
    for (const solid of current) {
      // Cells whose centres lie inside the rectangle.
      const x0 = Math.max(0, Math.ceil(solid.x * gx - 0.5));
      const x1 = Math.min(gx - 1, Math.floor((solid.x + solid.w) * gx - 0.5));
      const y0 = Math.max(0, Math.ceil(solid.y * gy - 0.5));
      const y1 = Math.min(gy - 1, Math.floor((solid.y + solid.h) * gy - 0.5));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const i = (y * gx + x) * 4;
          data[i] = solid.vx;
          data[i + 1] = solid.vy;
          data[i + 2] = 1;
        }
      }
    }
    return data;
  };

  return { update, cells };
}
