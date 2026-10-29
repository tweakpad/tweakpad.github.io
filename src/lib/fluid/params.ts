/*
 * The fluid's tunable parameters: every number the solver and the two display layers take that is
 * a matter of taste rather than of the method. The defaults are the home page's look; the tuning
 * panel's fluid section (tuning.ts) edits a copy live, and its "Copy values" output pastes back
 * over DEFAULT_PARAMS.
 */

export interface FluidParams {
  /** The layer behind the cards: the dye, and the light the pressure gives off. */
  lights: {
    /** How quickly dye saturates into colour. */
    exposure: number;
    opacity: number;
    /** How much the stage's edges darken. */
    vignette: number;
    /** The share of dye kept from one step to the next. */
    persistence: number;
  };
  /**
   * The water lit where a card pushes it, in the page's primary colour: ahead of a card that moves,
   * or around one that rises, the pressure goes up.
   */
  pressure: {
    /** Turns the solver's pressure into light. */
    gain: number;
    /** Suction behind a moving card, against the push ahead of it; 0 lights only the push. */
    suction: number;
    /** The share of the light kept each step once the push eases, so it fades like an afterglow. */
    afterglow: number;
    /** The response's exponent; under 1 lifts a slow push against a fast one. */
    curve: number;
    /** The light along a card's border. */
    rim: number;
    /** The border's width, in CSS pixels. */
    rimWidth: number;
    /** The light in the water around it, as far as the pressure reaches. */
    halo: number;
    /** Dye added where the pressure rises, which the water then carries off: a lit wake. */
    wake: number;
  };
  flow: {
    /** The share of velocity kept from one step to the next. */
    persistence: number;
    /** Vorticity confinement: how much small eddies are restored. */
    vorticity: number;
    /** Jacobi iterations of the pressure solve; more spread the pressure further from a card. */
    pressureIterations: number;
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
    /** A resting card's strength as a wall, 0..1, so how hard it pushes; a lifted card is 1. */
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
  lights: { exposure: 1.9, opacity: 1, vignette: 1, persistence: 0.937 },
  pressure: { gain: 1.09, suction: 0.34, afterglow: 0.92, curve: 0.8, rim: 1.4, rimWidth: 11, halo: 0.36, wake: 11.1 },
  flow: { persistence: 0.975, vorticity: 13, pressureIterations: 5 },
  pointer: { dye: 0.35, force: 0.8, size: 0.002 },
  cards: { resting: 1, swellPush: 7.2, swellBand: 8 },
  fog: { cards: 0.85, background: 0 },
};
