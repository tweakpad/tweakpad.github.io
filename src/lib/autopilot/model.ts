/*
 * Queries over the world the pattern canvas publishes (WorldLayout in lib/scene.ts): a packed
 * mosaic that repeats across its period. A card there is a copy of a composition, `{ i, k }`: the
 * card's index in the world and which copy of the period it is in. Copies share their pattern, but
 * a card is never named by its element. Positions are world pixels, +Y down; stage = world + pan.
 */
import type { Box, WorldItem, WorldLayout } from '../scene';

export type Point = readonly [number, number];

export interface CardRef {
  i: number;
  k: number;
}

export const itemOf = (layout: WorldLayout, ref: CardRef): WorldItem | undefined => layout.items[ref.i];

/** The card's footprint: the card and its caption. */
export function itemBox(layout: WorldLayout, ref: CardRef): Box | undefined {
  const item = layout.items[ref.i];
  return item ? { x: item.x + ref.k * layout.period, y: item.y, w: item.w, h: item.h } : undefined;
}

const offset = (outer: Box, inner: Box): Box => ({
  x: outer.x + inner.x,
  y: outer.y + inner.y,
  w: inner.w,
  h: inner.h,
});

export function cardBox(layout: WorldLayout, ref: CardRef): Box | undefined {
  const box = itemBox(layout, ref);
  const item = itemOf(layout, ref);
  return box && item ? offset(box, item.card) : undefined;
}

export function captionBox(layout: WorldLayout, ref: CardRef): Box | undefined {
  const box = itemBox(layout, ref);
  const item = itemOf(layout, ref);
  return box && item ? offset(box, item.caption) : undefined;
}

export const centreOf = (box: Box): Point => [box.x + box.w / 2, box.y + box.h / 2];

export const sameCard = (a: CardRef | undefined, b: CardRef | undefined) =>
  !!a && !!b && a.i === b.i && a.k === b.k;

/** A card as a string, to key sets and maps by. */
export const keyOf = (ref: CardRef) => `${ref.i},${ref.k}`;

/** The card as the canvas knows it: every copy of it answers. */
export const featureOf = (ref: CardRef) => ({ item: ref.i });

/** Every card whose centre lies within `radius` of `point`, with its centre and pattern. */
export function cardsNear(layout: WorldLayout, point: Point, radius: number) {
  const found: { ref: CardRef; centre: Point; pattern: string }[] = [];
  const reach = radius + Math.max(layout.cardWidth, layout.tallest);
  layout.query({ x: point[0] - reach, y: point[1] - reach, w: reach * 2, h: reach * 2 }, (i, k) => {
    const ref = { i, k };
    const box = cardBox(layout, ref)!;
    if (box.w <= 0 || box.h <= 0) return;
    const centre = centreOf(box);
    if (Math.hypot(centre[0] - point[0], centre[1] - point[1]) <= radius) {
      found.push({ ref, centre, pattern: layout.items[i]!.pattern });
    }
  });
  return found;
}

/** The card whose centre is nearest `point`. */
export function nearestCard(layout: WorldLayout, point: Point): CardRef | undefined {
  for (let radius = layout.cardWidth; radius < layout.cardWidth * 16; radius *= 2) {
    const near = cardsNear(layout, point, radius);
    if (!near.length) continue;
    let best = near[0]!;
    let distance = Infinity;
    for (const card of near) {
      const d = Math.hypot(card.centre[0] - point[0], card.centre[1] - point[1]);
      if (d < distance) [distance, best] = [d, card];
    }
    return best.ref;
  }
  return undefined;
}

/** The same card in a newer layout of the same build: indices never change, so it is itself. */
export function relocate(layout: WorldLayout, ref: CardRef): CardRef | undefined {
  return layout.items[ref.i] ? ref : undefined;
}
