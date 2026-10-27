/*
 * From vgpu's fluid example (https://vgpu.sh/examples/fluid, MIT, see LICENSE). Changed for the
 * home page: the pointer is read from a separate element, a still option renders one settled frame
 * instead of animating, and the loop disposes itself once the canvas leaves the document. The grid
 * follows the canvas's shape (see simulation.ts).
 */
import { surface, type Gpu, type Surface } from 'vgpu';

import { installStirInput } from './pointer-input';
import {
  createFluid,
  prepareFluid,
  renderFluid,
  resizeFluid,
  stepFluid,
  type Fluid,
} from './simulation';

const FIXED_STEP = 1 / 60;
/** Steps a still frame runs first, so the dye has spread before it is drawn. */
const WARMUP_STEPS = 120;

interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** The element whose pointer movement stirs the fluid; the canvas by default. */
  input?: HTMLElement;
  /** Render one settled frame and stop, for reduced motion. */
  still?: boolean;
}

function fixedStepCount(accumulator: number, elapsed: number) {
  let next = accumulator + Math.min(elapsed, 1 / 30);
  let steps = 0;
  while (next >= FIXED_STEP && steps < 2) {
    next -= FIXED_STEP;
    steps++;
  }
  return { steps, accumulator: steps === 2 ? 0 : next };
}

export function createRenderer(options: RendererOptions) {
  let disposed = false;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let fluid: Fluid | undefined;
  let input: ReturnType<typeof installStirInput> | undefined;
  let animationFrame = 0;
  let accumulator = 0;
  let previous = 0;
  let redrawStill: (() => void) | undefined;

  const tick = (now: number) => {
    if (disposed) return;
    if (!options.canvas.isConnected) {
      dispose();
      return;
    }
    if (!document.hidden && fluid && input && canvasSurface) {
      const fixed = fixedStepCount(accumulator, (now - previous) / 1000);
      accumulator = fixed.accumulator;
      for (let i = 0; i < fixed.steps; i++) {
        stepFluid(fluid, input);
      }
      renderFluid(fluid, canvasSurface);
    }
    // Always reset the clock while hidden so visibility changes never catch up.
    previous = now;
    animationFrame = requestAnimationFrame(tick);
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (redrawStill) removeEventListener('resize', redrawStill);
    input?.dispose();
    gpu?.dispose();
  }

  function fail(error: unknown): never {
    dispose();
    throw error;
  }

  const initialize = async () => {
    const { init } = await import('vgpu');
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    canvasSurface = surface(gpu, options.canvas, { dpr: [1, 2] });
    fluid = createFluid(gpu);
    await prepareFluid(fluid, canvasSurface);
    if (disposed) return;
    canvasSurface.onResize(() => {
      if (disposed || !fluid || !canvasSurface) return;
      try {
        resizeFluid(fluid, canvasSurface);
      } catch (error) {
        fail(error);
      }
    });
    if (options.still) {
      const settle = (current: Fluid) => {
        for (let i = 0; i < WARMUP_STEPS; i++) stepFluid(current);
      };
      // A frame refits the surface as it starts, so drawing again after a resize refits it. A
      // canvas of a new shape gets a new grid, which settles again before it is drawn. vgpu
      // refuses a frame inside a resize callback, so the redraw waits for the next one.
      const draw = () => {
        if (disposed || !fluid || !canvasSurface) return;
        renderFluid(fluid, canvasSurface);
        if (fluid.pendingGrid) {
          settle(fluid);
          renderFluid(fluid, canvasSurface);
        }
      };
      redrawStill = () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(draw);
      };
      addEventListener('resize', redrawStill);
      settle(fluid);
      draw();
      return;
    }
    input = installStirInput(options.canvas, options.input ?? options.canvas);
    previous = performance.now();
    animationFrame = requestAnimationFrame(tick);
  };

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    fail(error);
  });

  return { ready, dispose };
}
