/** Development-only adapter. The intro runtime has no dependency on this module. */
import { DEFAULT_INTRO_PARAMS, type IntroParams } from './home-intro-params';
import { addSection, storedParams } from './tuning';

const STORAGE_KEY = 'tweakpad:intro:3';

export function introParams(): IntroParams {
  return storedParams(STORAGE_KEY, DEFAULT_INTRO_PARAMS);
}

export function tuneIntro(params: IntroParams, replay: () => void) {
  return addSection({
    key: STORAGE_KEY,
    title: 'Intro',
    params,
    defaults: DEFAULT_INTRO_PARAMS,
    literal: { name: 'DEFAULT_INTRO_PARAMS', type: 'IntroParams' },
    apply() {},
    build(folder) {
      folder.addBinding(params, 'timelineScale', { label: 'Timeline scale', min: 0.1, max: 3, step: 0.05 });
      folder.addBinding(params, 'sidebarScale', { label: 'Sidebar duration scale', min: 1, max: 5, step: 0.25 });
      folder.addBinding(params, 'gridScale', { label: 'Dot blast duration scale', min: 0.25, max: 8, step: 0.25 });
      folder.addBinding(params, 'headingDuration', { label: 'Heading reveal duration', min: 100, max: 3000, step: 50 });
      folder.addBinding(params, 'sidebarTextScale', { label: 'Text duration scale', min: 1, max: 5, step: 0.25 });
      for (const key of ['grid', 'overlap', 'border', 'cards', 'cardContent', 'sidebar', 'sidebarContent', 'sidebarStagger', 'softness'] as const) {
        const labels = { cardContent: 'Card content fade', sidebarContent: 'Text reveal duration', sidebarStagger: 'Component stagger' };
        folder.addBinding(params, key, {
          label: key in labels ? labels[key as keyof typeof labels] : key,
          min: 0, max: key === 'softness' ? 400 : 1500, step: 10,
        });
      }
      folder.addBinding(params, 'ease', {
        options: { 'Circ out': 'outCirc', Smooth: 'out(3)', Gentle: 'inOut(2)', Linear: 'linear' },
      });
      folder.addButton({ title: 'Replay' }).on('click', replay);
    },
  });
}
