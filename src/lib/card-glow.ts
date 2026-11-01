/*
 * The light on the pattern canvas's cards: each card's border is a Glow border
 * (`tp-mo-glow-border`), and this decides what lights it. That is the visitor's pointer, which the
 * Glow border follows on its own, or, while the autopilot flies the canvas, the trail head that
 * stirs the water. When a card is struck, by the head or by the pointer entering it, its light
 * starts on the point of entry and then draws away from the card along the struck edge's normal,
 * so the glow flares there and fades out in place. Only `trackPoint` is written, and only when it
 * changes; the canvas supplies where every card is drawn, so nothing here reads the layout.
 */
import type { TpMoGlowBorder } from '@tweakpad/ui';

export interface GlowParams {
  /** How far a light carries, in CSS pixels: the cards' `track-reach`. */
  reach: number;
  /** How long a struck card's flare takes to fade out, in seconds. */
  impact: number;
}

/** A card the canvas draws: its Glow border, and where it is drawn this frame. */
export interface GlowCard {
  readonly glow: TpMoGlowBorder;
  /** The card as drawn, in stage pixels, and the scale its lift draws it at. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
  /** Whether any of it is on the stage; cards off it keep their light as it was. */
  readonly onStage: boolean;
}

/** What lights the cards this frame. */
export type GlowSource =
  /** The visitor's pointer, which each Glow border follows itself. */
  | { readonly kind: 'pointer' }
  /** A point in stage pixels: the autopilot's trail head. */
  | { readonly kind: 'flow'; readonly point: readonly [number, number] }
  /** Nothing: the cards fade out. */
  | { readonly kind: 'off' };

type Point = { x: number; y: number };

/** A light far out of every card's reach, so a card lit by it fades out through its own fade. */
const OFF: Point = Object.freeze({ x: -1e6, y: -1e6 });
/** The share of the flare spent at full strength on the point of entry before it draws away. */
const HOLD = 0.12;

interface Impact {
  /** The point of entry, in CSS pixels from the card's top-left, before any lift. */
  offset: readonly [number, number];
  /** The struck edge's outward normal. */
  normal: readonly [number, number];
  /** When it struck, in milliseconds on the frame clock. */
  start: number;
}

export function createCardGlow(initial: GlowParams) {
  let params = initial;
  const impacts = new Map<TpMoGlowBorder, Impact>();

  /** Sets a card's light, unless it is already there to within half a pixel. */
  const assign = (glow: TpMoGlowBorder, point: Point | null) => {
    const current = glow.trackPoint;
    if (point === current) return;
    if (point && current && Math.abs(point.x - current.x) < 0.5 && Math.abs(point.y - current.y) < 0.5) return;
    glow.trackPoint = point;
  };

  /** How far a flare's light has drawn away from the card, `t` of the way through it. */
  const away = (t: number) => {
    const fade = Math.max(0, (t - HOLD) / (1 - HOLD));
    // Fast at first, so the flare drops off quickly and lingers faintly at the end.
    return params.reach * (1 - (1 - fade) * (1 - fade));
  };

  return {
    /**
     * Lights every card for this frame from `source`, or from its flare while it has one. `origin`
     * is the stage's top-left in the viewport; `now` is the frame's time, in milliseconds.
     */
    update(now: number, cards: Iterable<GlowCard>, source: GlowSource, origin: readonly [number, number]) {
      const [ox, oy] = origin;
      const shared: Point | null =
        source.kind === 'pointer'
          ? null
          : source.kind === 'off'
            ? OFF
            : { x: ox + source.point[0], y: oy + source.point[1] };
      // A flow light lights only the cards it reaches; the rest are given the light far away, once,
      // so they never update for it.
      const margin = params.reach * 1.25;
      const reaches = (card: GlowCard) => {
        if (source.kind !== 'flow') return true;
        const [px, py] = source.point;
        const dx = Math.max(card.x - px, 0, px - card.x - card.w);
        const dy = Math.max(card.y - py, 0, py - card.y - card.h);
        return Math.hypot(dx, dy) <= margin;
      };
      for (const card of cards) {
        const hit = impacts.get(card.glow);
        if (hit) {
          const t = (now - hit.start) / 1000 / Math.max(0.05, params.impact);
          if (t < 1) {
            const out = away(Math.max(0, t));
            assign(card.glow, {
              x: ox + card.x + (hit.offset[0] + hit.normal[0] * out) * card.scale,
              y: oy + card.y + (hit.offset[1] + hit.normal[1] * out) * card.scale,
            });
            continue;
          }
          impacts.delete(card.glow);
        }
        if (card.onStage) assign(card.glow, reaches(card) ? shared : OFF);
      }
    },
    /**
     * Strikes a card at `offset` (CSS pixels from its top-left, before any lift) on the edge whose
     * outward normal is `normal`; a card struck again starts over.
     */
    impact(glow: TpMoGlowBorder, offset: readonly [number, number], normal: readonly [number, number], now: number) {
      impacts.set(glow, { offset, normal, start: now });
    },
    setParams(next: GlowParams) {
      params = next;
    },
  };
}
