/*
 * The pattern canvas's tunable layout (PatternCanvas.astro); the tuning panel's "Canvas" section
 * edits a copy live, and its "Copy values" output pastes back over DEFAULT_CANVAS_PARAMS.
 */

export interface CanvasParams {
  /** The gap between columns, in CSS pixels. */
  gapX: number;
  /** The gap between the compositions of a column, in CSS pixels. */
  gapY: number;
}

export const DEFAULT_CANVAS_PARAMS: CanvasParams = { gapX: 64, gapY: 64 };
