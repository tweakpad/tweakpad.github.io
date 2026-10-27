/**
 * Site-only artwork for the preview toolbar, in the library's icon shape (24-unit stroke icons,
 * after Lucide). The library ships no density or code icons, so these live here.
 */
import type { IconDefinition } from '@tweakpad/ui/icons/types';

const RECT = 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z';

/** Three rows: the default density. */
export const densityDefaultIcon: IconDefinition = {
  viewBox: '0 0 24 24',
  paths: [{ d: RECT, strokeWidth: 2 }, { d: 'M21 9H3M21 15H3', strokeWidth: 2 }],
};

/** Four rows: the compact density. */
export const densityCompactIcon: IconDefinition = {
  viewBox: '0 0 24 24',
  paths: [{ d: RECT, strokeWidth: 2 }, { d: 'M21 7.5H3M21 12H3M21 16.5H3', strokeWidth: 2 }],
};

/** Angle brackets: the copyable source. */
export const codeIcon: IconDefinition = {
  viewBox: '0 0 24 24',
  paths: [{ d: 'm16 18 6-6-6-6M8 6l-6 6 6 6', strokeWidth: 2 }],
};
