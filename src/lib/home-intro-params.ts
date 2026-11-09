/** Runtime defaults; independent of the development tuning panel. */
export interface IntroParams {
  impulseDistanceCards: number;
  headerDuration: number;
  timelineScale: number;
  grid: number;
  gridScale: number;
  overlap: number;
  border: number;
  cards: number;
  introCard: number;
  cardScale: number;
  headingDuration: number;
  cardContent: number;
  cardTextScale: number;
  cardStagger: number;
  softness: number;
  ease: string;
}

export const DEFAULT_INTRO_PARAMS: IntroParams = {
  impulseDistanceCards: 5,
  headerDuration: 900,
  timelineScale: 1,
  grid: 750,
  gridScale: 4,
  overlap: 590,
  border: 1190,
  cards: 200,
  introCard: 550,
  cardScale: 1,
  headingDuration: 1850,
  cardContent: 200,
  cardTextScale: 2.5,
  cardStagger: 160,
  softness: 400,
  ease: 'outCirc',
};

/** Master duration multiplier: 1x fits the stages into 1.5 s; 2x and 3x stretch playback. */
export function introTimelineScale(params: IntroParams): number {
  const overlap = Math.min(params.grid, Math.max(0, params.overlap));
  const duration = params.grid - overlap + params.border + params.cards + params.introCard + params.cardContent;
  return Math.min(1, 1500 / Math.max(1, duration)) * Math.min(3, Math.max(0.1, params.timelineScale));
}
