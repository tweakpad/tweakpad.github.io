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
    /** The final run into the card, which stays straight, and where the head bursts to its impact speed. */
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
    /** Its speed when it strikes the card, as a multiple of its speed, and its burst to it, px/s². */
    impact: number;
    burst: number;
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
  debug: {
    enabled: boolean;
    /** The cards the route keeps clear of, grown by the clearance, and where it may land. */
    obstacles: boolean;
    route: boolean;
    path: boolean;
    agents: boolean;
  };
}

export const DEFAULT_AUTOPILOT_PARAMS: AutopilotParams = {
  enabled: true,
  timing: { interval: 6, variance: 2, idle: 5 },
  target: { minDistance: 450, maxDistance: 1400 },
  route: { clearance: 22, angle: 50, approach: 140, spread: 0.5, variety: 0.25 },
  endings: { radius: 90, tension: 0.55, sway: 0, wavelength: 400 },
  halls: { radius: 160, tension: 0.55, sway: 4, wavelength: 520 },
  head: {
    speed: 620,
    acceleration: 900,
    cornering: 2600,
    impact: 1.8,
    burst: 6000,
  },
  camera: {
    frequency: 3,
    damping: 0.85,
    lead: 0.7,
    focusFrequency: 2.8,
    overshoot: 0.06,
    blend: 0.6,
    drift: 8,
    driftRate: 0.35,
  },
  trail: { strength: 1, carry: 0.5, impact: 0.8 },
  debug: { enabled: false, obstacles: true, route: true, path: true, agents: true },
};
