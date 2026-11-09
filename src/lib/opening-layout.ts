/** Pick the first centered obstacle, never a later card hidden behind an earlier one. */
export function firstVerticalLanding<T extends { pattern: string; box: { x: number; y: number; w: number; h: number } }>(cards: readonly T[], x: number, y: number): T | undefined {
  return cards.filter(card => card.pattern !== '__intro' && card.box.w > 0 && card.box.h > 0
    && Math.abs(card.box.x + card.box.w / 2 - x) <= 1 && card.box.y > y)
    .sort((a, b) => a.box.y - b.box.y)[0];
}
