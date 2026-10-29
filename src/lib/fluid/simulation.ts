// From vgpu's fluid example (https://vgpu.sh/examples/fluid, MIT, see LICENSE). Changed for the
// home page: the example solves on a fixed 128 × 72 grid, which stretches on any canvas that is not
// 16:9. Here the grid keeps about the same number of cells but takes the canvas's shape, so cells
// stay square, and a canvas that changes shape gets a new grid before the next step. Walls (see
// solids.ts) are drawn by solids.wgsl into mask textures, one at each grid's resolution, that the
// solver reads, and move with the layer's velocity, so the fluid flows around the cards and is
// pushed when they move. A card is a faint wall while it rests and a solid one once it has risen
// on hover. The fluid is drawn in two layers: the dye as lights on a canvas behind the cards, and
// the page-coloured fog on a canvas over them, which veils a resting card and opens over a risen
// one. Pressure colours the dye, so the flow shows where the cards squeeze it. Everything a matter
// of taste is a parameter (params.ts), which `setParams` changes live.
import type { Gpu, Target } from "vgpu";
import type { StirInput } from "./pointer-input";
import { DEFAULT_PARAMS, type FluidParams, type Rgb } from "./params";
import advectVelocityWgsl from "./advect-velocity.wgsl";
import curlWgsl from "./curl.wgsl";
import vorticityWgsl from "./vorticity.wgsl";
import divergenceWgsl from "./divergence.wgsl";
import pressureWgsl from "./pressure.wgsl";
import projectWgsl from "./project.wgsl";
import advectDyeWgsl from "./advect-dye.wgsl";
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

/** Colours the display takes from the page, as sRGB 0..1. */
export interface FluidColors {
  /** The fog's colour: the page background. */
  fog: readonly [number, number, number];
  /** The colour pressure adds to the dye. */
  pressure: readonly [number, number, number];
}
const DEFAULT_COLORS: FluidColors = { fog: [0.09, 0.09, 0.11], pressure: [0.55, 0.49, 1] };

/** The two canvases the fluid is drawn into. */
export interface FluidOutputs {
  /** Behind the cards: the dye. Its shape sets the grid's. */
  lights: Target;
  /** Over the cards: the fog. */
  fog: Target;
}

/**
 * The idle lights' paths: per light and axis, the amplitude, rate and phase of a sine about the
 * paths' centre, so the two wander without ever repeating together.
 */
const PATHS = [
  [
    [0.28, 0.73, 0],
    [0.22, 1.09, 0.4],
  ],
  [
    [0.26, 0.61, Math.PI],
    [0.24, 0.97, 2.1],
  ],
] as const;

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
const rgb = (color: Rgb): [number, number, number] => [color.r, color.g, color.b];

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

/**
 * The wall masks, one texel per cell of what reads each: strength and swell for the velocity grid,
 * strength for the dye grid, and the cards and how far each has risen, for the fog, at the fog
 * canvas's own resolution.
 */
function createMasks(gpu: Gpu, grid: Size) {
  const clearColor = [0, 0, 0, 0] as const;
  return {
    velocity: target(gpu, { size: grid, format: "rg8unorm", clearColor, label: "walls (velocity)" }),
    dye: target(gpu, { size: dyeSizeOf(grid), format: "r8unorm", clearColor, label: "walls (dye)" }),
    cards: target(gpu, { size: [16, 9], format: "rg8unorm", clearColor, label: "walls (cards)" }),
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
  /** How far along their paths the idle lights are; it advances at the motion speed. */
  phase: number;
  lastInputStep: number;
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
    phase: 0,
    lastInputStep: -1000,
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
  applyDisplay(fluid);
}

function applyDisplay(fluid: Fluid): void {
  const { lights, fog } = fluid.params;
  fluid.passes.lights.set({
    config: {
      output_size: fluid.lightsSize,
      dye_size: dyeSizeOf(fluid.grid),
      exposure: lights.exposure,
      opacity: lights.opacity,
      vignette: lights.vignette,
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
  return [p.wallsVelocity, p.wallsDye, p.wallsCards];
}

export function destroyFluid(fluid: Fluid): void {
  destroyBuffers(fluid.buffers);
  destroyBuffer(fluid.masks.velocity);
  destroyBuffer(fluid.masks.dye);
  destroyBuffer(fluid.masks.cards);
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
    // One draw per mask: each keeps its own raster uniforms. Additive, so walls never erase each other.
    wallsVelocity: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (velocity)" }),
    wallsDye: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (dye)" }),
    wallsCards: draw(gpu, { shader: solidsWgsl, vertices: 6, blend: "additive", label: "walls (cards)" }),
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

/** Draws the cards into the fog's mask. Called every frame, so the fog keeps up with the cards. */
function drawCards(fluid: Fluid, walls?: Walls): void {
  syncWalls(fluid, walls);
  const size = walls?.size ?? fluid.fogSize;
  fluid.passes.wallsCards
    .set({ raster: { size, cells: fluid.fogSize, mode: 1, band: 0 } })
    .draw({ target: fluid.masks.cards, instances: walls?.count ?? 0 });
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
  fluid.step++;
  fluid.phase += fluid.params.motion.speed / 60;
  input?.consumeStep();
}

/** Draws the lights behind the cards and the fog over them, the fog fitted to `walls`. */
export function renderFluid(fluid: Fluid, outputs: FluidOutputs, walls?: Walls): void {
  drawCards(fluid, walls);
  fluid.passes.lights.set({ dye: fluid.buffers.dye.read });
  fluid.passes.fog.set({ cards: fluid.masks.cards });
  frame(fluid.gpu, (currentFrame) => {
    currentFrame.pass(outputs.lights, fluid.passes.lights);
    currentFrame.pass(outputs.fog, fluid.passes.fog);
  });
}

function inputUniforms(fluid: Fluid, input?: StirInput) {
  const { params } = fluid;
  const time = fluid.step / 60;
  const a = idleLight(fluid, 0);
  const b = idleLight(fluid, 1);
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
    idle_a: [...a.position, ramp * idle, params.lightA.size],
    idle_b: [...b.position, ramp * idle, params.lightB.size],
    pressure_color: [...fluid.colors.pressure, params.flow.pressureGlow],
    color_a: [...rgb(params.lightA.color), params.lightA.strength],
    color_b: [...rgb(params.lightB.color), params.lightB.strength],
    path_a: a.velocity,
    path_b: b.velocity,
    light_force: [params.motion.push, params.motion.swirl],
    keep: [params.flow.persistence, params.lights.persistence],
    stroke: [params.pointer.size, params.pointer.force, params.pointer.dye, 0],
    swell_push: params.cards.swellPush,
  };
}

/** Where an idle light is on its path, in the solver's space (+Y up), and how fast it is moving. */
function idleLight(fluid: Fluid, index: 0 | 1) {
  const { speed, orbit, centerX, centerY } = fluid.params.motion;
  const centre = [centerX, 1 - centerY];
  const position: [number, number] = [0, 0];
  const velocity: [number, number] = [0, 0];
  PATHS[index].forEach(([amplitude, rate, offset], axis) => {
    const angle = rate * fluid.phase + offset;
    position[axis] = centre[axis]! + orbit * amplitude * Math.sin(angle);
    velocity[axis] = speed * orbit * amplitude * rate * Math.cos(angle);
  });
  return { position, velocity };
}
