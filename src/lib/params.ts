/*
 * Helpers for the stage's tunable parameter sets (the fluid's, the canvas layout's, the
 * autopilot's): plain objects of numbers, booleans and nested groups, with defaults in code that
 * the tuning panel (tuning.ts) edits live. Kept apart from the panel, so reading parameters never
 * loads Tweakpane.
 */

/** A deep copy of `params`, so a tuned set never shares objects with its defaults. */
export function cloneParams<T extends object>(params: T): T {
  return structuredClone(params);
}

/**
 * Copies every value of `source` that has a place in `target` into it, in place, so bindings to
 * `target`'s groups stay live; anything renamed or of another type is skipped.
 */
export function assignParams<T extends object>(target: T, source: unknown): T {
  const assign = (into: Record<string, unknown>, from: unknown) => {
    if (!from || typeof from !== 'object') return;
    for (const [key, value] of Object.entries(from)) {
      const current = into[key];
      if (typeof current === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        into[key] = value;
      } else if (typeof current === 'boolean' && typeof value === 'boolean') {
        into[key] = value;
      } else if (current && typeof current === 'object') {
        assign(current as Record<string, unknown>, value);
      }
    }
  };
  assign(target as unknown as Record<string, unknown>, source);
  return target;
}
