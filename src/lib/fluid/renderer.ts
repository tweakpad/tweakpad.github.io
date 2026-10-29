/*
 * From vgpu's fluid example (https://vgpu.sh/examples/fluid, MIT, see LICENSE). Changed for the
 * home page: the pointer is read from a separate element, a still option renders one settled frame
 * instead of animating, and the loop disposes itself once the canvases leave the document. The
 * fluid is drawn into two canvases, the lights behind the cards and the fog over them; the grid
 * follows their shape (see simulation.ts), and the stage scene supplies the walls.
 */
import { surface, type Gpu, type Surface } from 'vgpu';

import type { Scene } from '../scene';
import { cloneParams, type FluidParams } from './params';
import { installStirInput, type Frame } from './pointer-input';
import { trackWalls, type WallTracker } from './solids';
import {
  createFluid,
  prepareFluid,
  renderFluid,
  resizeFluid,
  setColors,
  setParams,
  stepFluid,
  type Fluid,
  type FluidColors,
} from './simulation';

const FIXED_STEP = 1 / 60;
/** Steps a still frame runs first, so the dye has spread before it is drawn. */
const WARMUP_STEPS = 120;

interface RendererOptions {
  /** The canvas behind the cards, for the lights. */
  lights: HTMLCanvasElement;
  /** The canvas over the cards, the same size, for the fog. */
  fog: HTMLCanvasElement;
  /** The element whose pointer movement stirs the fluid; the lights canvas by default. */
  input?: HTMLElement;
  /** Render one settled frame and stop, for reduced motion. */
  still?: boolean;
  /** The stage scene: its rectangles are walls the fluid flows around, and are pushed by. */
  scene?: Scene;
  /** The page's colours for the fog and the pressure dye; `setColors` changes them later. */
  colors?: FluidColors;
  /** The look; the defaults when left out. `setParams` changes it later. */
  params?: FluidParams;
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
  let outputs: { lights: Surface; fog: Surface } | undefined;
  let fluid: Fluid | undefined;
  let input: ReturnType<typeof installStirInput> | undefined;
  let walls: WallTracker | undefined;
  /** The pending frame's cancellation, while one is pending. */
  let cancelFrame: (() => void) | undefined;
  let accumulator = 0;
  let previous = 0;
  let redrawStill: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let colors = options.colors;
  let params = options.params ?? cloneParams();

  // With a scene, each frame waits for the stage's layout, so the fog and the rims fit the cards
  // as they are drawn this frame rather than as they were the last.
  const nextFrame = (callback: FrameRequestCallback) => {
    if (options.scene) return options.scene.requestFrame(callback, 'draw');
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  };

  // The pointer is placed within the stage the scene describes; before it has published, the
  // canvas's own size serves, as both fill the stage.
  const frame: Frame = () => {
    const scene = options.scene;
    if (scene && scene.size[0] > 0) {
      return { left: scene.origin[0], top: scene.origin[1], width: scene.size[0], height: scene.size[1] };
    }
    return { left: 0, top: 0, width: options.lights.clientWidth, height: options.lights.clientHeight };
  };

  const tick = (now: number) => {
    if (disposed) return;
    if (!options.lights.isConnected) {
      dispose();
      return;
    }
    if (!document.hidden && fluid && input && outputs) {
      const elapsed = (now - previous) / 1000;
      const fixed = fixedStepCount(accumulator, elapsed);
      accumulator = fixed.accumulator;
      // Read every frame, so the fog keeps up with the cards between steps too.
      const current = walls?.update(elapsed, params.cards.resting);
      for (let i = 0; i < fixed.steps; i++) {
        stepFluid(fluid, input, current);
      }
      renderFluid(fluid, outputs, current);
    }
    // Always reset the clock while hidden so visibility changes never catch up.
    previous = now;
    cancelFrame = nextFrame(tick);
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelFrame?.();
    if (redrawStill) removeEventListener('resize', redrawStill);
    unsubscribe?.();
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
    // The lights are soft, so one pixel per CSS pixel is plenty; the fog's card edges are crisp.
    const current = {
      lights: surface(gpu, options.lights, { dpr: 1 }),
      fog: surface(gpu, options.fog, { dpr: [1, 2] }),
    };
    outputs = current;
    fluid = createFluid(gpu, params);
    if (colors) setColors(fluid, colors);
    await prepareFluid(fluid, current);
    if (disposed) return;
    const refit = () => {
      if (disposed || !fluid) return;
      try {
        resizeFluid(fluid, current);
      } catch (error) {
        fail(error);
      }
    };
    current.lights.onResize(refit);
    current.fog.onResize(refit);
    if (options.scene) walls = trackWalls(options.scene);
    if (options.still) {
      const settle = (settling: Fluid) => {
        const stepWalls = walls?.update(0, params.cards.resting);
        for (let i = 0; i < WARMUP_STEPS; i++) stepFluid(settling, undefined, stepWalls);
      };
      // A frame refits the surfaces as it starts, so drawing again after a resize refits them. A
      // canvas of a new shape gets a new grid, which settles again before it is drawn. vgpu
      // refuses a frame inside a resize callback, so the redraw waits for the next one. Each frame
      // fits the fog to the latest cards, so a card lifted on hover gets its hole in it.
      const draw = () => {
        if (disposed || !fluid) return;
        renderFluid(fluid, current, walls?.update(0, params.cards.resting));
        if (fluid.pendingGrid) {
          settle(fluid);
          renderFluid(fluid, current, walls?.update(0, params.cards.resting));
        }
      };
      redrawStill = () => {
        cancelFrame?.();
        cancelFrame = nextFrame(draw);
      };
      addEventListener('resize', redrawStill);
      // The stage lays itself out after the first frame, and changes on drag or hover; the still
      // frame follows without settling again.
      unsubscribe = options.scene?.subscribe(() => redrawStill?.());
      settle(fluid);
      draw();
      return;
    }
    input = installStirInput(options.input ?? options.lights, frame);
    previous = performance.now();
    cancelFrame = nextFrame(tick);
  };

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    fail(error);
  });

  return {
    ready,
    dispose,
    /** Changes the page colours, for a theme switch. */
    setColors(next: FluidColors) {
      colors = next;
      if (fluid && !disposed) {
        setColors(fluid, next);
        redrawStill?.();
      }
    },
    /** Changes the look; the next step and frame use it. */
    setParams(next: FluidParams) {
      params = next;
      if (fluid && !disposed) {
        setParams(fluid, next);
        redrawStill?.();
      }
    },
  };
}
