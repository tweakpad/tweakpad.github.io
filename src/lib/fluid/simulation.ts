// From vgpu's fluid example (https://vgpu.sh/examples/fluid, MIT, see LICENSE). Changed for the
// home page: the example solves on a fixed 128 × 72 grid, which stretches on any canvas that is not
// 16:9. Here the grid keeps about the same number of cells but takes the canvas's shape, so cells
// stay square, and a canvas that changes shape gets a new grid before the next step. Walls (see
// solids.ts) are drawn by solids.wgsl into mask textures, one at each grid's resolution, that the
// solver reads, and move with the layer's velocity, so the fluid flows around the cards and is
// pushed when they move.
import type { Gpu, Target } from "vgpu";
import type { StirInput } from "./pointer-input";
import advectVelocityWgsl from "./advect-velocity.wgsl";
import curlWgsl from "./curl.wgsl";
import vorticityWgsl from "./vorticity.wgsl";
import divergenceWgsl from "./divergence.wgsl";
import pressureWgsl from "./pressure.wgsl";
import projectWgsl from "./project.wgsl";
import advectDyeWgsl from "./advect-dye.wgsl";
import displayWgsl from "./display.wgsl";
import solidsWgsl from "./solids.wgsl";
import { compute, draw, effect, frame, pingPongStorage, storage, target } from "vgpu";

type Size = readonly [number, number];

/** The example's cell budget, 128 × 72, spread over the canvas's shape. */
const CELL_BUDGET = 128 * 72;
const DYE_SCALE = 4;
const WORKGROUP = 8;
/** The most walls one step takes; far more than fit on any screen. */
export const MAX_WALLS = 64;
/** Floats per wall in `Walls.data`: x, y, width, height, radius and padding to the shader's stride. */
export const WALL_FLOATS = 8;

/** A grid shaped like `output` with about CELL_BUDGET cells; extreme shapes are capped. */
function gridFor(output: Size): Size {
  const aspect = Math.min(4, Math.max(0.25, output[0] / Math.max(1, output[1])));
  return [
    Math.round(Math.sqrt(CELL_BUDGET * aspect)),
    Math.round(Math.sqrt(CELL_BUDGET / aspect)),
  ];
}

const sameSize = (a: Size, b: Size) => a[0] === b[0] && a[1] === b[1];
const groups = (size: Size): Size => [
  Math.ceil(size[0] / WORKGROUP),
  Math.ceil(size[1] / WORKGROUP),
];

function createBuffers(gpu: Gpu, grid: Size) {
  const cells = grid[0] * grid[1];
  const dyeCells = cells * DYE_SCALE * DYE_SCALE;
  const allocated: object[] = [];
  try {
    const velocity = pingPongStorage(gpu, cells * 8);
    allocated.push(velocity.read, velocity.write);
    const dye = pingPongStorage(gpu, dyeCells * 16);
    allocated.push(dye.read, dye.write);
    const pressure = pingPongStorage(gpu, cells * 4);
    allocated.push(pressure.read, pressure.write);
    const divergence = storage(gpu, cells * 4, "read-write");
    allocated.push(divergence);
    const curl = storage(gpu, cells * 4, "read-write");
    allocated.push(curl);
    return { velocity, dye, pressure, divergence, curl };
  } catch (error) {
    for (const buffer of allocated) {
      destroyBuffer(buffer);
    }
    throw error;
  }
}

type Buffers = ReturnType<typeof createBuffers>;

const dyeSizeOf = (grid: Size): Size => [grid[0] * DYE_SCALE, grid[1] * DYE_SCALE];

/** The wall masks: single-channel, one texel per cell of the grid that reads each. */
function createMasks(gpu: Gpu, grid: Size) {
  const options = { format: "r8unorm" as const, clearColor: [0, 0, 0, 0] as const };
  return {
    velocity: target(gpu, { size: grid, ...options, label: "walls (velocity)" }),
    dye: target(gpu, { size: dyeSizeOf(grid), ...options, label: "walls (dye)" }),
  };
}

type Masks = ReturnType<typeof createMasks>;

export interface Fluid {
  gpu: Gpu;
  grid: Size;
  buffers: Buffers;
  masks: Masks;
  /** The walls' rectangles; independent of the grid, so it outlives grid changes. */
  rects: ReturnType<typeof storage>;
  passes: ReturnType<typeof createPasses>;
  outputSize: Size;
  /** The grid the canvas's current shape calls for, applied before the next step. */
  pendingGrid: Size | undefined;
  /** The `Walls.version` last uploaded to `rects`. */
  wallsVersion: number;
  step: number;
  lastInputStep: number;
}

export function createFluid(gpu: Gpu): Fluid {
  const grid = gridFor([16, 9]);
  const fluid: Fluid = {
    gpu,
    grid,
    buffers: createBuffers(gpu, grid),
    masks: createMasks(gpu, grid),
    rects: storage(gpu, MAX_WALLS * WALL_FLOATS * 4, "read"),
    passes: createPasses(gpu),
    outputSize: [16, 9],
    pendingGrid: undefined,
    wallsVersion: -1,
    step: 0,
    lastInputStep: -1000,
  };
  applyGrid(fluid);
  return fluid;
}

export function destroyFluid(fluid: Fluid): void {
  destroyBuffers(fluid.buffers);
  destroyBuffer(fluid.masks.velocity);
  destroyBuffer(fluid.masks.dye);
  destroyBuffer(fluid.rects);
}

function destroyBuffers(buffers: Buffers) {
  const all = [
    buffers.velocity.read,
    buffers.velocity.write,
    buffers.dye.read,
    buffers.dye.write,
    buffers.pressure.read,
    buffers.pressure.write,
    buffers.divergence,
    buffers.curl,
  ];
  for (const buffer of all) {
    destroyBuffer(buffer);
  }
}

function destroyBuffer(buffer: object) {
  (buffer as { destroy(): void }).destroy();
}

function createPasses(gpu: Gpu) {
  return {
    advectVelocity: compute(gpu, advectVelocityWgsl),
    curl: compute(gpu, curlWgsl),
    vorticity: compute(gpu, vorticityWgsl),
    divergence: compute(gpu, divergenceWgsl),
    pressure: compute(gpu, pressureWgsl),
    project: compute(gpu, projectWgsl),
    advectDye: compute(gpu, advectDyeWgsl),
    // One draw per mask: each keeps its own raster uniforms.
    wallsVelocity: draw(gpu, { shader: solidsWgsl, vertices: 6, label: "walls (velocity)" }),
    wallsDye: draw(gpu, { shader: solidsWgsl, vertices: 6, label: "walls (dye)" }),
    display: effect(gpu, displayWgsl),
  };
}

/** Points every pass at the current grid. */
function applyGrid(fluid: Fluid): void {
  const dyeSize = dyeSizeOf(fluid.grid);
  const p = fluid.passes;
  for (const pass of [
    p.advectVelocity,
    p.curl,
    p.vorticity,
    p.divergence,
    p.pressure,
    p.project,
    p.advectDye,
  ]) {
    pass.set({ grid: { size: fluid.grid, dye_size: dyeSize } });
  }
  p.display.set({ config: { output_size: fluid.outputSize, dye_size: dyeSize } });
}

/**
 * Swaps in buffers for a pending grid. The dye starts over: a new grid is a new simulation. Called
 * between steps, once the previous step's dispatches are submitted, so the old buffers are free.
 */
function syncGrid(fluid: Fluid): void {
  const grid = fluid.pendingGrid;
  if (!grid) return;
  fluid.pendingGrid = undefined;
  const previous = fluid.buffers;
  fluid.buffers = createBuffers(fluid.gpu, grid);
  fluid.grid = grid;
  destroyBuffers(previous);
  fluid.masks.velocity.resize(grid);
  fluid.masks.dye.resize(dyeSizeOf(grid));
  applyGrid(fluid);
}

export async function prepareFluid(
  fluid: Fluid,
  output: Target
): Promise<void> {
  resizeFluid(fluid, output);
  syncGrid(fluid);
  await fluid.passes.display.compile({ colors: [output.format] });
}

/** Fits the display to `output`; a new shape queues a new grid for the next step. */
export function resizeFluid(fluid: Fluid, output: Target): void {
  fluid.outputSize = output.size;
  const grid = gridFor(output.size);
  fluid.pendingGrid = sameSize(grid, fluid.grid) ? undefined : grid;
  applyGrid(fluid);
}

/** Walls in stage pixels, packed WALL_FLOATS per wall (see solids.wgsl), with the layer's velocity. */
export interface Walls {
  /** The stage, in CSS pixels; the rectangles' coordinate space. */
  size: Size;
  /** In the solver's units: stage fractions per second, +Y up. */
  velocity: readonly [number, number];
  count: number;
  data: Float32Array<ArrayBuffer>;
  /** Changes whenever `data` does, so an unchanged set is not uploaded again. */
  version: number;
}

export function stepFluid(fluid: Fluid, input?: StirInput, walls?: Walls): void {
  syncGrid(fluid);
  if (input?.active) fluid.lastInputStep = fluid.step;
  const dynamic = inputUniforms(fluid, input);
  const p = fluid.passes;
  const { velocity, dye, pressure, divergence, curl } = fluid.buffers;
  const { masks } = fluid;
  const dyeSize = dyeSizeOf(fluid.grid);
  const [gx, gy] = groups(fluid.grid);
  const [dx, dy] = groups(dyeSize);

  // The masks are drawn again every step: the grid, as well as the walls, may have changed. Each
  // draw clears its mask first, so no walls leave it empty.
  if (walls && walls.version !== fluid.wallsVersion) {
    fluid.wallsVersion = walls.version;
    fluid.rects.write(walls.data);
  }
  const stage = walls?.size ?? fluid.outputSize;
  const instances = walls?.count ?? 0;
  const motion = { velocity: walls?.velocity ?? [0, 0] };
  p.wallsVelocity
    .set({ raster: { size: stage, cells: fluid.grid }, rects: fluid.rects })
    .draw({ target: masks.velocity, instances });
  p.wallsDye
    .set({ raster: { size: stage, cells: dyeSize }, rects: fluid.rects })
    .draw({ target: masks.dye, instances });

  p.advectVelocity
    .set({
      input: dynamic,
      src: velocity.read,
      dst: velocity.write,
      walls: masks.velocity,
      motion,
    })
    .dispatch(gx, gy);
  velocity.swap();

  // Confinement restores the small rotating details lost by semi-Lagrangian advection.
  p.curl
    .set({ velocity: velocity.read, curl })
    .dispatch(gx, gy);
  p.vorticity
    .set({
      src: velocity.read,
      curl,
      dst: velocity.write,
      walls: masks.velocity,
    })
    .dispatch(gx, gy);
  velocity.swap();

  p.divergence
    .set({ velocity: velocity.read, divergence, walls: masks.velocity, motion })
    .dispatch(gx, gy);
  for (let i = 0; i < 3; i++) {
    p.pressure
      .set({
        params: { decay: i === 0 ? 0.8 : 1 },
        src: pressure.read,
        divergence,
        dst: pressure.write,
        walls: masks.velocity,
      })
      .dispatch(gx, gy);
    pressure.swap();
  }

  p.project
    .set({
      src: velocity.read,
      pressure: pressure.read,
      dst: velocity.write,
      walls: masks.velocity,
      motion,
    })
    .dispatch(gx, gy);
  velocity.swap();

  p.advectDye
    .set({
      input: dynamic,
      src: dye.read,
      velocity: velocity.read,
      dst: dye.write,
      walls: masks.dye,
    })
    .dispatch(dx, dy);
  dye.swap();
  fluid.step++;
  input?.consumeStep();
}

export function renderFluid(fluid: Fluid, output: Target): void {
  fluid.passes.display.set({ dye: fluid.buffers.dye.read });
  frame(fluid.gpu, (currentFrame) => {
    currentFrame.pass(output, fluid.passes.display);
  });
}

function inputUniforms(fluid: Fluid, input?: StirInput) {
  const time = fluid.step / 60;
  const [a, b] = idleEmitters(fluid.step);
  const sinceInput = fluid.step - fluid.lastInputStep;
  const idle =
    sinceInput < 90 ? 0.15 : 0.15 + 0.85 * Math.min(1, (sinceInput - 90) / 60);
  const ramp = Math.min(1, (fluid.step + 1) / 24);
  let pointerVelocity = input?.velocity ?? ([0, 0] as [number, number]);
  if (input?.active && Math.hypot(...pointerVelocity) < 0.02) {
    pointerVelocity = [0.16 * Math.cos(time * 5), 0.16 * Math.sin(time * 5)];
  }
  const speed = Math.hypot(...pointerVelocity);
  const direction =
    speed > 1e-4
      ? [pointerVelocity[0] / speed, pointerVelocity[1] / speed]
      : [0, 0];
  return {
    step: fluid.step,
    pointer_active: input?.active ? 1 : 0,
    pointer_from: input?.from ?? [0.5, 0.5],
    pointer_to: input?.to ?? [0.5, 0.5],
    pointer_velocity: pointerVelocity,
    // Like the reference, splat color comes from movement direction, with blue held high.
    pointer_color: [0.5 + 0.5 * direction[0]!, 0.5 + 0.5 * direction[1]!, 1, 1],
    idle_a: [...a, ramp * idle, 0.006],
    idle_b: [...b, ramp * idle, 0.0055],
  };
}

function idleEmitters(step: number): [[number, number], [number, number]] {
  const t = step / 60;
  return [
    [0.5 + 0.28 * Math.sin(0.73 * t), 0.5 + 0.22 * Math.sin(1.09 * t + 0.4)],
    [
      0.5 + 0.26 * Math.sin(0.61 * t + Math.PI),
      0.5 + 0.24 * Math.sin(0.97 * t + 2.1),
    ],
  ];
}
