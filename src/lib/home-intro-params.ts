/** Runtime defaults; independent of the development tuning panel. */
export interface IntroParams {
  timelineScale: number;
  grid: number;
  overlap: number;
  border: number;
  cards: number;
  cardContent: number;
  sidebar: number;
  sidebarScale: number;
  sidebarContent: number;
  sidebarTextScale: number;
  sidebarStagger: number;
  softness: number;
  ease: string;
}

export const DEFAULT_INTRO_PARAMS: IntroParams = {
  timelineScale: 1,
  grid: 750,
  overlap: 590,
  border: 1190,
  cards: 200,
  cardContent: 800,
  sidebar: 550,
  sidebarScale: 1,
  sidebarContent: 200,
  sidebarTextScale: 2.5,
  sidebarStagger: 160,
  softness: 400,
  ease: 'outCirc',
};

/** Master duration multiplier: 1x fits the stages into 1.5 s; 2x and 3x stretch playback. */
export function introTimelineScale(params: IntroParams): number {
  const overlap = Math.min(params.grid, Math.max(0, params.overlap));
  const duration = params.grid - overlap + params.border + params.cards + params.sidebar + params.sidebarContent;
  return Math.min(1, 1500 / Math.max(1, duration)) * Math.min(3, Math.max(0.1, params.timelineScale));
}
