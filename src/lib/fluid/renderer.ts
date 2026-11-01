/*
 * From vgpu's fluid example (https://vgpu.sh/examples/fluid, MIT, see LICENSE). Changed for the
 * home page: the pointer is read from a separate element, a still option renders one settled frame
 * instead of animating, and the loop disposes itself once the canvases leave the document. The
 * fluid is drawn into two canvases, the lights behind the cards and the fog over them, and the
 * stage's dot grid into a third under the water, lit by the pointer or the autopilot's trail head;
 * the grid follows their shape (see simulation.ts), and the stage scene supplies the walls and the
 * dots.
 */
import { surface, type Gpu, type Surface } from 'vgpu';

import type { Scene } from '../scene';
import { cloneParams } from '../params';
import { DEFAULT_PARAMS, type FluidParams } from './params';
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
  type DotsView,
  type Fluid,
  type FluidColors,
  type FluidStir,
} from './simulation';

const FIXED_STEP = 1 / 60;
/** Steps a still frame runs first, so the dye has spread before it is drawn. */
const WARMUP_STEPS = 120;

interface RendererOptions {
  /** The canvas behind the cards, for the lights. */
  lights: HTMLCanvasElement;
  /** The canvas over the cards, the same size, for the fog. */
  fog: HTMLCanvasElement;
  /** A canvas under the lights, the same size, for the dot grid the scene describes. */
  dots?: HTMLCanvasElement;
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
  let outputs: { lights: Surface; fog: Surface; dots?: Surface } | undefined;
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
  /** The start of the scene's stir segment not yet stepped, as frames without a step skip it. */
  let stirFrom: readonly [number, number] | undefined;
  /** The light over the dot grid, in stage pixels, and how strong it is now. */
  const dotLight = { x: 0, y: 0, strength: 0 };
  /** The burst playing on the grid: where it struck, the pan then, and when; none at first. */
  let burst: { at: readonly [number, number]; pan: readonly [number, number]; start: number; count: number } | undefined;

  /** The scene's stir in the solver's units: stage fractions, +Y up. */
  const sceneStir = (): FluidStir | undefined => {
    const stir = options.scene?.stir;
    const [width, height] = options.scene?.size ?? [0, 0];
    if (!stir || width <= 0 || height <= 0) return undefined;
    const at = (point: readonly [number, number]) => [point[0] / width, 1 - point[1] / height] as const;
    return {
      strength: stir.strength,
      from: at(stir.from),
      to: at(stir.to),
      velocity: [stir.velocity[0] / width, -stir.velocity[1] / height],
      carry: [stir.carry[0] / width, -stir.carry[1] / height],
      grip: stir.grip,
    };
  };
  let params = options.params ?? cloneParams(DEFAULT_PARAMS);

  // With a scene, each frame waits for the stage's layout, so the fog and the rims fit the cards
  // as they are drawn this frame rather than as they were the last.
  const nextFrame = (callback: FrameRequestCallback) => {
    if (options.scene) return options.scene.requestFrame(callback, 'draw');
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  };

  /**
   * The dot grid for this frame, `dt` seconds after the last. Its light is the visitor's pointer
   * while it is over the stage, or, while a pilot flies the layer, its stirring trail head; it
   * comes and goes over the fade time, and stays where it last was while it fades.
   */
  const dotsView = (dt: number): DotsView | undefined => {
    const scene = options.scene;
    const dots = scene?.dots;
    if (!scene || !dots) return undefined;
    let target = 0;
    let at: readonly [number, number] | undefined;
    if (scene.pilot?.active) {
      const stir = scene.stir;
      if (stir && stir.strength > 0) {
        target = Math.min(1, stir.strength);
        at = stir.to;
      }
    } else if (input?.over) {
      const { left, top } = frame();
      at = [input.over[0] - left, input.over[1] - top];
      target = 1;
    }
    if (at) {
      dotLight.x = at[0];
      dotLight.y = at[1];
    }
    const fade = Math.max(0.01, params.dots.fade);
    dotLight.strength += (target - dotLight.strength) * (dt > 0 ? 1 - Math.exp(-dt / fade) : 0);
    if (dotLight.strength < 1e-3 && target === 0) dotLight.strength = 0;
    // A new strike starts a burst, which moves with the layer, like the card it struck.
    const now = performance.now();
    const struck = scene.burst;
    if (struck && struck.count !== burst?.count) burst = { ...struck, start: now };
    let burstAt: readonly [number, number] = [0, 0];
    let burstAge = -1;
    if (burst) {
      const age = (now - burst.start) / 1000;
      if (age < params.dots.burst.duration) {
        burstAt = [burst.at[0] + scene.pan[0] - burst.pan[0], burst.at[1] + scene.pan[1] - burst.pan[1]];
        burstAge = age;
      }
    }
    return {
      stage: scene.size,
      offset: dots.offset,
      spacing: dots.spacing,
      radius: dots.radius,
      light: [dotLight.x, dotLight.y],
      strength: dotLight.strength,
      burstAt,
      burstAge,
    };
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
      const stir = sceneStir();
      if (stir && !stirFrom) stirFrom = stir.from;
      for (let i = 0; i < fixed.steps; i++) {
        // The first step covers the stir's path since the last step; any more stay at its end.
        const from = i === 0 && stirFrom ? stirFrom : stir?.to;
        stepFluid(fluid, input, current, stir && from ? { ...stir, from } : undefined);
      }
      if (fixed.steps) stirFrom = undefined;
      renderFluid(fluid, outputs, current, dotsView(elapsed));
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
    // The dots are a pixel across, so they take the display's own pixels, as the CSS dots did.
    const current = {
      lights: surface(gpu, options.lights, { dpr: 1 }),
      fog: surface(gpu, options.fog, { dpr: [1, 2] }),
      dots: options.dots ? surface(gpu, options.dots, { dpr: [1, 2] }) : undefined,
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
    current.dots?.onResize(refit);
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
        renderFluid(fluid, current, walls?.update(0, params.cards.resting), dotsView(0));
        if (fluid.pendingGrid) {
          settle(fluid);
          renderFluid(fluid, current, walls?.update(0, params.cards.resting), dotsView(0));
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
