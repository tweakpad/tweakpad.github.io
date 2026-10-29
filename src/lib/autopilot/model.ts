/*
 * Queries over the world the pattern canvas publishes (WorldLayout in lib/scene.ts): unwrapped,
 * so column `u` is any integer and each column repeats down the world. A card there is a copy of
 * a composition, `{ u, k, row }`: its column, which repetition of the column, and its row. Copies
 * share their element on the page, so a card is never named by its element. Positions are world
 * pixels, +Y down; stage = world + pan.
 */
import type { Box, WorldItem, WorldLayout } from '../scene';

export type Point = readonly [number, number];

export interface CardRef {
  u: number;
  k: number;
  row: number;
}

export const mod = (value: number, size: number) => ((value % size) + size) % size;

/** One column and the gutter beside it. */
export const pitch = (layout: WorldLayout) => layout.columnWidth + layout.gap[0];

/** The column of the page that world column `u` shows. */
export const columnIndex = (layout: WorldLayout, u: number) => mod(u, layout.columns.length);

const columnOf = (layout: WorldLayout, u: number) => layout.columns[columnIndex(layout, u)]!;

export const columnLeft = (layout: WorldLayout, u: number) => layout.offsetX + u * pitch(layout);

/** The world column a world x lies in, the gutter to its right included. */
export const columnAt = (layout: WorldLayout, x: number) =>
  Math.floor((x - layout.offsetX + layout.gap[0] / 2) / pitch(layout));

export const itemOf = (layout: WorldLayout, ref: CardRef): WorldItem | undefined =>
  columnOf(layout, ref.u).items[ref.row];

/** The item's box: the card and its caption, as wide as the column. */
export function itemBox(layout: WorldLayout, ref: CardRef): Box | undefined {
  const column = columnOf(layout, ref.u);
  const item = column.items[ref.row];
  if (!item) return undefined;
  return {
    x: columnLeft(layout, ref.u),
    y: column.phase + item.y + ref.k * column.height,
    w: layout.columnWidth,
    h: item.height,
  };
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
  !!a && !!b && a.u === b.u && a.k === b.k && a.row === b.row;

/** Every card whose centre lies within `radius` of `point`, with its centre and pattern. */
export function cardsNear(layout: WorldLayout, point: Point, radius: number) {
  const found: { ref: CardRef; centre: Point; pattern: string }[] = [];
  const first = columnAt(layout, point[0] - radius) - 1;
  const last = columnAt(layout, point[0] + radius) + 1;
  for (let u = first; u <= last; u += 1) {
    const column = columnOf(layout, u);
    if (column.height <= 0) continue;
    column.items.forEach((item, row) => {
      const top = column.phase + item.y;
      const lowest = Math.floor((point[1] - radius - top - item.height) / column.height);
      const highest = Math.ceil((point[1] + radius - top) / column.height);
      for (let k = lowest; k <= highest; k += 1) {
        const ref = { u, k, row };
        const box = cardBox(layout, ref)!;
        const centre = centreOf(box);
        if (Math.hypot(centre[0] - point[0], centre[1] - point[1]) <= radius) {
          found.push({ ref, centre, pattern: item.pattern });
        }
      }
    });
  }
  return found;
}

/** The card whose centre is nearest `point`. */
export function nearestCard(layout: WorldLayout, point: Point): CardRef | undefined {
  for (let radius = layout.columnWidth; radius < layout.columnWidth * 16; radius *= 2) {
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

/**
 * The same card after a relayout: the copy of its column and row nearest where it was, as the
 * copies are renumbered when a column's height changes.
 */
export function relocate(layout: WorldLayout, ref: CardRef, top: number): CardRef | undefined {
  const column = columnOf(layout, ref.u);
  const item = column.items[ref.row];
  if (!item || column.height <= 0) return undefined;
  return { ...ref, k: Math.round((top - column.phase - item.y) / column.height) };
}
