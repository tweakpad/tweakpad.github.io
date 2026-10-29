/*
 * The fluid's tunable parameters: every number the solver and the two display layers take that is
 * a matter of taste rather than of the method. The defaults are the home page's look; tuning.ts
 * edits a copy live, and its "Copy values" output pastes back over DEFAULT_PARAMS.
 */

/** An sRGB colour, 0..1 per channel, as Tweakpane's float colour binding edits it. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One of the two idle lights that wander the stage. */
export interface LightParams {
  color: Rgb;
  /** Dye added per step at the light's centre. */
  strength: number;
  /** The light's spread: the variance of its Gaussian, in stage heights squared. */
  size: number;
}

export interface FluidParams {
  /** The dye, drawn behind the cards. */
  lights: {
    /** How quickly dye saturates into colour. */
    exposure: number;
    opacity: number;
    /** How much the stage's edges darken. */
    vignette: number;
    /** The share of dye kept from one step to the next. */
    persistence: number;
  };
  lightA: LightParams;
  lightB: LightParams;
  /** How the idle lights wander. */
  motion: {
    speed: number;
    /** The size of their paths, 1 for the default. */
    orbit: number;
    /** The middle of their paths, in stage fractions, +Y down. */
    centerX: number;
    centerY: number;
    /** How hard a light pushes the fluid along its path, and around it. */
    push: number;
    swirl: number;
  };
  flow: {
    /** The share of velocity kept from one step to the next. */
    persistence: number;
    /** Vorticity confinement: how much small eddies are restored. */
    vorticity: number;
    /** Jacobi iterations of the pressure solve; more keep the flow closer to incompressible. */
    pressureIterations: number;
    /** Dye added where the flow is squeezed, in the page's primary colour. */
    pressureGlow: number;
  };
  pointer: {
    /** Dye a stroke adds. */
    dye: number;
    /** How much of the pointer's velocity a stroke gives the fluid. */
    force: number;
    /** The stroke's spread, in stage heights squared. */
    size: number;
  };
  cards: {
    /** A resting card's strength as a wall, 0..1; a lifted card is always 1. */
    resting: number;
    /** How hard a rising card pushes the fluid away. */
    swellPush: number;
    /** The width of that push, in solver cells. */
    swellBand: number;
  };
  /** The page-coloured veil, drawn over the cards. */
  fog: {
    /** Over a resting card; a lifted card has risen through it. */
    cards: number;
    /** Over the stage between the cards, and the lights there. */
    background: number;
  };
}

export const DEFAULT_PARAMS: FluidParams = {
  lights: { exposure: 1.35, opacity: 1, vignette: 0.32, persistence: 0.97 },
  lightA: { color: { r: 0.05, g: 0.48, b: 1 }, strength: 0.12, size: 0.006 },
  lightB: { color: { r: 1, g: 0.08, b: 0.55 }, strength: 0.115, size: 0.0055 },
  motion: { speed: 1, orbit: 1, centerX: 0.5, centerY: 0.5, push: 2.6, swirl: 2 },
  flow: { persistence: 0.98, vorticity: 20, pressureIterations: 3, pressureGlow: 5 },
  pointer: { dye: 0.35, force: 0.8, size: 0.002 },
  cards: { resting: 0.15, swellPush: 4, swellBand: 3 },
  fog: { cards: 0.55, background: 0 },
};

/** A deep copy of `params`, so a tuned set never shares objects with the defaults. */
export function cloneParams(params: FluidParams = DEFAULT_PARAMS): FluidParams {
  return structuredClone(params);
}

/**
 * Copies every value of `source` that has a place in `target` into it, in place, so bindings to
 * `target`'s groups stay live; anything renamed or of the wrong type is skipped.
 */
export function assignParams(target: FluidParams, source: unknown): FluidParams {
  const assign = (into: Record<string, unknown>, from: unknown) => {
    if (!from || typeof from !== 'object') return;
    for (const [key, value] of Object.entries(from)) {
      const current = into[key];
      if (typeof current === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        into[key] = value;
      } else if (current && typeof current === 'object') {
        assign(current as Record<string, unknown>, value);
      }
    }
  };
  assign(target as unknown as Record<string, unknown>, source);
  return target;
}
