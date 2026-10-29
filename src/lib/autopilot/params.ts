/*
 * The autopilot's tunable parameters: when it moves, where it goes, the route's shape, and how the
 * trail head and the camera move along it. The defaults are the home page's look; the tuning
 * panel's "Autopilot" section (tuning.ts) edits a copy live, and its "Copy values" output pastes
 * back over DEFAULT_AUTOPILOT_PARAMS. Lengths are CSS pixels, times seconds.
 */

/** How one part of the route is rounded off. */
export interface Smoothing {
  /** The corner radius. */
  radius: number;
  /** The corner's fullness: 0 cuts it with a chamfer, about 0.55 rounds it, 1 squares it out. */
  tension: number;
  /** A slow sideways weave along the straight runs, so the trail is not on rails; 0 for none. */
  sway: number;
  /** The weave's wavelength. */
  wavelength: number;
}

export interface AutopilotParams {
  enabled: boolean;
  timing: {
    /** How long a card stays in focus before the next is picked. */
    interval: number;
    /** Up to this much longer or shorter, at random. */
    variance: number;
    /** How long the visitor must leave the canvas alone before it takes over again. */
    idle: number;
  };
  target: {
    /** How far the next card may be from the current one, between their centres. */
    minDistance: number;
    maxDistance: number;
  };
  route: {
    /** How far the route keeps from the cards it passes. */
    clearance: number;
    /** The most the final run may lean from straight into the card's edge, in degrees. */
    angle: number;
    /** The shortest the final run into the card may be: it stays straight, for the head's burst along it. */
    approach: number;
    /** How far from the middle of a side the impact may land, as a share of the side. */
    spread: number;
    /** How much longer than the shortest a route may be, as a share, to vary where it lands. */
    variety: number;
  };
  /** The two endings: the run out of the first card, and the turn into the second. */
  endings: Smoothing;
  /** The corners in between. */
  halls: Smoothing;
  head: {
    /** The trail head's speed along the straight runs. */
    speed: number;
    /** How quickly it speeds up and slows down. */
    acceleration: number;
    /** How hard it may turn: the corner speed is √(this × radius). */
    cornering: number;
    /** Its speed when it strikes the card, as a multiple of its speed; the burst gets it there. */
    impact: number;
    /**
     * How far before the card the burst begins, along the final straight run; the route looks for
     * one this long. The jump in speed lasts the run-up over the mean of the wind-up and impact
     * speeds, so a longer run-up, or a slower impact, gives it longer to show.
     */
    runUp: number;
    /** The share of its speed it eases down to before the burst, so the jump reads; 1 for none. */
    windup: number;
  };
  camera: {
    /** How closely it follows the head: the spring's frequency, rad/s, and damping ratio. */
    frequency: number;
    damping: number;
    /** How far ahead of the head it aims, as a share of its own lag: 1 cancels the lag. */
    lead: number;
    /** Its spring when it settles on a card, and how far past it swings, as a share. */
    focusFrequency: number;
    overshoot: number;
    /** How long it takes to turn from the head to the card. */
    blend: number;
    /** The handheld drift while it rests on a card: how far, and how fast it wanders. */
    drift: number;
    driftRate: number;
  };
  /**
   * The head's trail in the water. The head stirs it as the pointer does, with the fluid's pointer
   * settings, moving through the water around it at its own speed through the hallway.
   */
  trail: {
    /** How hard it stirs: 1 as hard as the pointer. */
    strength: number;
    /**
     * How firmly the water around it keeps to the cards' motion: 1 keeps its wake in the hallway,
     * 0 leaves the water as still as the pointer finds it.
     */
    carry: number;
    /** How much harder it stirs over the final run into the card: 0 no harder. */
    impact: number;
  };
}

export const DEFAULT_AUTOPILOT_PARAMS: AutopilotParams = {
  enabled: true,
  timing: { interval: 6, variance: 2, idle: 5 },
  target: { minDistance: 2000, maxDistance: 4000 },
  route: { clearance: 22, angle: 50, approach: 250, spread: 0.5, variety: 0.25 },
  endings: { radius: 137, tension: 0.55, sway: 0, wavelength: 400 },
  halls: { radius: 160, tension: 0.55, sway: 4, wavelength: 520 },
  head: {
    speed: 2000,
    acceleration: 2120,
    cornering: 2600,
    impact: 1.75,
    runUp: 600,
    windup: 0.3,
  },
  camera: {
    frequency: 3,
    damping: 0.3,
    lead: 0.7,
    focusFrequency: 2.8,
    overshoot: 0.115,
    blend: 0.6,
    drift: 8,
    driftRate: 0.35,
  },
  trail: { strength: 1, carry: 0.5, impact: 0.8 },
};
