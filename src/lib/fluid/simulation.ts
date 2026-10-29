// From vgpu's fluid example (https://vgpu.sh/examples/fluid, MIT, see LICENSE). Changed for the
// home page: the example solves on a fixed 128 × 72 grid, which stretches on any canvas that is not
// 16:9. Here the grid keeps about the same number of cells but takes the canvas's shape, so cells
// stay square, and a canvas that changes shape gets a new grid before the next step. Walls (see
// solids.ts) are drawn by solids.wgsl into mask textures, one at each grid's resolution, that the
// solver reads, and move with the layer's velocity, so the cards are hulls the water flows around
// and is pushed by when they move; how solid a resting card is is a parameter, a risen one is
// solid. The fluid is drawn in two layers. Behind the cards, the water is lit where its pressure
// rises, along the border of a card that pushes it and in the wake it leaves, with the pointer's
// strokes as coloured dye; over the cards, the page-coloured fog veils a resting card and opens
// over a risen one. Everything a matter of taste is a parameter (params.ts), which `setParams`
// changes live.
import type { Gpu, Target } from "vgpu";
import type { StirInput } from "./pointer-input";
import { DEFAULT_PARAMS, type FluidParams } from "./params";
import advectVelocityWgsl from "./advect-velocity.wgsl";
import curlWgsl from "./curl.wgsl";
import vorticityWgsl from "./vorticity.wgsl";
import divergenceWgsl from "./divergence.wgsl";
import pressureWgsl from "./pressure.wgsl";
import projectWgsl from "./project.wgsl";
import advectDyeWgsl from "./advect-dye.wgsl";
import glowWgsl from "./glow.wgsl";
import lightsWgsl from "./lights.wgsl";
import fogWgsl from "./fog.wgsl";
import solidsWgsl from "./solids.wgsl";
import { compute, draw, effect, frame, pingPongStorage, storage, target } from "vgpu";

type Size = readonly [number, number];

/** The example's cell budget, 128 × 72, spread over the canvas's shape. */
const CELL_BUDGET = 128 * 72;
const DYE_SCALE = 4;
const WORKGROUP = 8;
/** The most walls one step takes, the length of the uniform array in solids.wgsl; far more than fit on any screen. */
export const MAX_WALLS = 64;
/**
 * The solver's pressure is in its own small units: measured at the edge of the cards, about 0.0002
 * as they drift, 0.006 when dragged at 1200 px/s. This brings that drag to about 1, so the light's
 * gain reads as a plain multiplier.
 */
const PRESSURE_SCALE = 200;
/** The share of the way to a brighter glow taken each step, so a push lights up within a few. */
const GLOW_ATTACK = 0.5;

/** Colours the display takes from the page, as sRGB 0..1. */
export interface FluidColors {
  /** The fog's colour: the page background. */
  fog: readonly [number, number, number];
  /** The colour of the light pressure gives off. */
  pressure: readonly [number, number, number];
}
const DEFAULT_COLORS: FluidColors = { fog: [0.09, 0.09, 0.11], pressure: [0.55, 0.49, 1] };

/** The two canvases the fluid is drawn into. */
export interface FluidOutputs {
  /** Behind the cards: the lit water. Its shape sets the grid's. */
  lights: Target;
  /** Over the cards: the fog. */
  fog: Target;
}

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
    const glow = storage(gpu, cells * 4, "read-write");
    allocated.push(glow);
    return { velocity, dye, pressure, divergence, curl, glow };
  } catch (error) {
    for (const buffer of allocated) {
      destroyBuffer(buffer);
    }
    throw error;
  }
}

type Buffers = ReturnType<typeof createBuffers>;

const dyeSizeOf = (grid: Size): Size => [grid[0] * DYE_SCALE, grid[1] * DYE_SCALE];

/**
 * The wall masks, one texel per cell of what reads each: strength and swell for the velocity grid,
 * strength for the dye grid, and for the display, at its canvases' own resolutions: the cards and
 * how far each has risen, for the fog, and their rims, for the lights.
 */
function createMasks(gpu: Gpu, grid: Size) {
  const clearColor = [0, 0, 0, 0] as const;
  return {
    velocity: target(gpu, { size: grid, format: "rg8unorm", clearColor, label: "walls (velocity)" }),
    dye: target(gpu, { size: dyeSizeOf(grid), format: "r8unorm", clearColor, label: "walls (dye)" }),
    cards: target(gpu, { size: [16, 9], format: "rg8unorm", clearColor, label: "walls (cards)" }),
    rims: target(gpu, { size: [16, 9], format: "r8unorm", clearColor, label: "walls (rims)" }),
  };
}

type Masks = ReturnType<typeof createMasks>;

export interface Fluid {
  gpu: Gpu;
  grid: Size;
  buffers: Buffers;
  masks: Masks;
  passes: ReturnType<typeof createPasses>;
  lightsSize: Size;
  fogSize: Size;
  /** The grid the canvas's current shape calls for, applied before the next step. */
  pendingGrid: Size | undefined;
  /** The `Walls.version` last set on the wall draws. */
  wallsVersion: number;
  colors: FluidColors;
  params: FluidParams;
  step: number;
}

export function createFluid(gpu: Gpu, params: FluidParams = DEFAULT_PARAMS): Fluid {
  const grid = gridFor([16, 9]);
  const fluid: Fluid = {
    gpu,
    grid,
    buffers: createBuffers(gpu, grid),
    masks: createMasks(gpu, grid),
    passes: createPasses(gpu),
    lightsSize: [16, 9],
    fogSize: [16, 9],
    pendingGrid: undefined,
    wallsVersion: -1,
    colors: DEFAULT_COLORS,
    params,
    step: 0,
  };
  applyGrid(fluid);
  setParams(fluid, params);
  // The wall draws need their array even before any walls arrive.
  const none: Wall[] = Array.from({ length: MAX_WALLS }, () => ({
    rect: [0, 0, 0, 0],
    radius: 0,
    strength: 0,
    swell: 0,
    lift: 0,
  }));
  for (const pass of wallDraws(fluid)) pass.set({ rects: none });
  return fluid;
}

/** Takes the page's colours; the display keeps them until the next call. */
export function setColors(fluid: Fluid, colors: FluidColors): void {
  fluid.colors = colors;
  applyDisplay(fluid);
}

/**
 * Takes a set of parameters. The solver reads the object on every step, so changes to it apply
 * from the next one; the call pushes them to the display and to the passes that keep uniforms.
 */
export function setParams(fluid: Fluid, params: FluidParams): void {
  fluid.params = params;
  fluid.passes.vorticity.set({ params: { strength: params.flow.vorticity } });
  fluid.passes.glow.set({
    params: {
      gain: params.pressure.gain * PRESSURE_SCALE,
      suction: params.pressure.suction,
      attack: GLOW_ATTACK,
      release: 1 - params.pressure.afterglow,
    },
  });
  applyDisplay(fluid);
}

function applyDisplay(fluid: Fluid): void {
  const { lights, pressure, fog } = fluid.params;
  fluid.passes.lights.set({
    config: {
      output_size: fluid.lightsSize,
      dye_size: dyeSizeOf(fluid.grid),
      grid_size: fluid.grid,
      exposure: lights.exposure,
      opacity: lights.opacity,
      vignette: lights.vignette,
      pressure_color: fluid.colors.pressure,
      curve: pressure.curve,
      rim: pressure.rim,
      halo: pressure.halo,
    },
  });
  fluid.passes.fog.set({
    config: {
      output_size: fluid.fogSize,
      fog_color: fluid.colors.fog,
      cards: fog.cards,
      background: fog.background,
      vignette: lights.vignette,
    },
  });
}

function wallDraws(fluid: Fluid) {
  const p = fluid.passes;
  return [p.wallsVelocity, p.wallsDye, p.wallsCards, p.wallsRims];
}

export function destroyFluid(fluid: Fluid): void {
  destroyBuffers(fluid.buffers);
  destroyBuffer(fluid.masks.velocity);
  destroyBuffer(fluid.masks.dye);
  destroyBuffer(fluid.masks.cards);
  destroyBuffer(fluid.masks.rims);
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
    buffers.glow,
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
    glow: compute(gpu, glowWgsl),
    // One draw per mask: each keeps its own raster uniforms. Additive, so walls never erase each other.
    wallsVelocity: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (velocity)" }),
    wallsDye: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (dye)" }),
    wallsCards: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (cards)" }),
    wallsRims: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (rims)" }),
    lights: effect(gpu, lightsWgsl),
    fog: effect(gpu, fogWgsl),
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
    p.glow,
  ]) {
    pass.set({ grid: { size: fluid.grid, dye_size: dyeSize } });
  }
  applyDisplay(fluid);
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

export async function prepareFluid(fluid: Fluid, outputs: FluidOutputs): Promise<void> {
  resizeFluid(fluid, outputs);
  syncGrid(fluid);
  await Promise.all([
    fluid.passes.lights.compile({ colors: [outputs.lights.format] }),
    fluid.passes.fog.compile({ colors: [outputs.fog.format] }),
  ]);
}

/** Fits the display to the outputs; a new shape queues a new grid for the next step. */
export function resizeFluid(fluid: Fluid, outputs: FluidOutputs): void {
  fluid.lightsSize = outputs.lights.size;
  fluid.fogSize = outputs.fog.size;
  if (!sameSize(fluid.masks.cards.size, fluid.fogSize)) fluid.masks.cards.resize(fluid.fogSize);
  if (!sameSize(fluid.masks.rims.size, fluid.lightsSize)) fluid.masks.rims.resize(fluid.lightsSize);
  const grid = gridFor(fluid.lightsSize);
  fluid.pendingGrid = sameSize(grid, fluid.grid) ? undefined : grid;
  applyGrid(fluid);
}

/** One wall as solids.wgsl declares it: x, y, width, height in stage pixels, the corner radius, and its state. */
export interface Wall {
  rect: [number, number, number, number];
  radius: number;
  /** How solid: the resting strength for a resting card, 1 for a risen one. */
  strength: number;
  /** How fast it is rising, 0..1. */
  swell: number;
  /** How far it has risen, 0..1. */
  lift: number;
}

/** The walls, with the layer's velocity. */
export interface Walls {
  /** The stage, in CSS pixels; the rectangles' coordinate space. */
  size: Size;
  /** In the solver's units: stage fractions per second, +Y up. */
  velocity: readonly [number, number];
  count: number;
  /** Always MAX_WALLS long; only the first `count` are drawn. */
  rects: readonly Wall[];
  /** Changes whenever `rects` does, so an unchanged set is not uploaded again. */
  version: number;
}

/** Sets the rectangles on the wall draws when they changed; a uniform keeps its last value. */
function syncWalls(fluid: Fluid, walls?: Walls): void {
  if (!walls || walls.version === fluid.wallsVersion) return;
  fluid.wallsVersion = walls.version;
  for (const pass of wallDraws(fluid)) pass.set({ rects: walls.rects });
}

/**
 * Draws the walls into the solver's masks. Called every step, since the grid as well as the walls
 * may have changed. Each draw clears its mask first, so no walls leave it empty.
 */
function drawWalls(fluid: Fluid, walls?: Walls): void {
  syncWalls(fluid, walls);
  const p = fluid.passes;
  const { masks } = fluid;
  const size = walls?.size ?? fluid.fogSize;
  const instances = walls?.count ?? 0;
  const band = (fluid.params.cards.swellBand * size[0]) / fluid.grid[0];
  p.wallsVelocity
    .set({ raster: { size, cells: fluid.grid, mode: 0, band } })
    .draw({ target: masks.velocity, instances });
  p.wallsDye
    .set({ raster: { size, cells: dyeSizeOf(fluid.grid), mode: 0, band } })
    .draw({ target: masks.dye, instances });
}

/**
 * Draws the cards into the display's masks, the fog's and the lights' rims. Called every frame, so
 * both keep up with the cards.
 */
function drawCards(fluid: Fluid, walls?: Walls): void {
  syncWalls(fluid, walls);
  const size = walls?.size ?? fluid.fogSize;
  const instances = walls?.count ?? 0;
  fluid.passes.wallsCards
    .set({ raster: { size, cells: fluid.fogSize, mode: 1, band: 0 } })
    .draw({ target: fluid.masks.cards, instances });
  fluid.passes.wallsRims
    .set({ raster: { size, cells: fluid.lightsSize, mode: 2, band: fluid.params.pressure.rimWidth } })
    .draw({ target: fluid.masks.rims, instances });
}

/**
 * A second pointer, the autopilot's trail head, in the solver's units: it stirs with the pointer's
 * stroke, through water that keeps to `carry` as firmly as `grip` says.
 */
export interface FluidStir {
  /** How hard it stirs: 1 as hard as the pointer. */
  strength: number;
  /** Its last step, in stage fractions, +Y up. */
  from: readonly [number, number];
  to: readonly [number, number];
  /** Its velocity through the water around it, in stage fractions per second, +Y up. */
  velocity: readonly [number, number];
  /** That water's velocity. */
  carry: readonly [number, number];
  /** How much of the way to `carry` the water at its centre goes each step. */
  grip: number;
}

export function stepFluid(fluid: Fluid, input?: StirInput, walls?: Walls, stir?: FluidStir): void {
  syncGrid(fluid);
  const dynamic = inputUniforms(fluid, input, stir);
  const p = fluid.passes;
  const { velocity, dye, pressure, divergence, curl } = fluid.buffers;
  const { masks } = fluid;
  const dyeSize = dyeSizeOf(fluid.grid);
  const [gx, gy] = groups(fluid.grid);
  const [dx, dy] = groups(dyeSize);

  drawWalls(fluid, walls);
  const motion = { velocity: walls?.velocity ?? [0, 0] };

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
  const iterations = Math.max(1, Math.round(fluid.params.flow.pressureIterations));
  for (let i = 0; i < iterations; i++) {
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
      pressure: pressure.read,
    })
    .dispatch(dx, dy);
  dye.swap();

  p.glow
    .set({ pressure: pressure.read, glow: fluid.buffers.glow })
    .dispatch(gx, gy);
  fluid.step++;
  input?.consumeStep();
}

/** Draws the lights behind the cards and the fog over them, both fitted to `walls`. */
export function renderFluid(fluid: Fluid, outputs: FluidOutputs, walls?: Walls): void {
  drawCards(fluid, walls);
  fluid.passes.lights.set({
    dye: fluid.buffers.dye.read,
    glow: fluid.buffers.glow,
    rims: fluid.masks.rims,
  });
  fluid.passes.fog.set({ cards: fluid.masks.cards });
  frame(fluid.gpu, (currentFrame) => {
    currentFrame.pass(outputs.lights, fluid.passes.lights);
    currentFrame.pass(outputs.fog, fluid.passes.fog);
  });
}

function inputUniforms(fluid: Fluid, input?: StirInput, stir?: FluidStir) {
  const { params } = fluid;
  const time = fluid.step / 60;
  let pointerVelocity = input?.velocity ?? ([0, 0] as [number, number]);
  if (input?.active && Math.hypot(...pointerVelocity) < 0.02) {
    pointerVelocity = [0.16 * Math.cos(time * 5), 0.16 * Math.sin(time * 5)];
  }
  const speed = Math.hypot(...pointerVelocity);
  const direction =
    speed > 1e-4
      ? [pointerVelocity[0] / speed, pointerVelocity[1] / speed]
      : [0, 0];
  const stirVelocity = stir?.velocity ?? [0, 0];
  const stirSpeed = Math.hypot(...stirVelocity);
  const stirDirection = stirSpeed > 1e-4 ? [stirVelocity[0] / stirSpeed, stirVelocity[1] / stirSpeed] : [0, 0];
  return {
    pointer_active: input?.active ? 1 : 0,
    pointer_from: input?.from ?? [0.5, 0.5],
    pointer_to: input?.to ?? [0.5, 0.5],
    pointer_velocity: pointerVelocity,
    // Like the reference, splat color comes from movement direction, with blue held high.
    pointer_color: [0.5 + 0.5 * direction[0]!, 0.5 + 0.5 * direction[1]!, 1, 1],
    pressure_color: [...fluid.colors.pressure, params.pressure.wake],
    keep: [params.flow.persistence, params.lights.persistence],
    stroke: [params.pointer.size, params.pointer.force, params.pointer.dye, 0],
    swell_push: params.cards.swellPush,
    stir_active: stir?.strength ?? 0,
    stir_from: stir?.from ?? [0.5, 0.5],
    stir_to: stir?.to ?? [0.5, 0.5],
    stir_velocity: stirVelocity,
    stir_carry: stir?.carry ?? [0, 0],
    stir_grip: stir?.grip ?? 0,
    // Coloured by its direction, like the pointer's.
    stir_color: [0.5 + 0.5 * stirDirection[0]!, 0.5 + 0.5 * stirDirection[1]!, 1, 1],
  };
}
