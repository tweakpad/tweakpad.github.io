/*
 * The autopilot's section of the tuning panel (lib/tuning.ts), over its parameters (params.ts).
 */
import type { FolderApi } from 'tweakpane';

import { addSection, storedParams } from '../tuning';
import { DEFAULT_AUTOPILOT_PARAMS, type AutopilotParams, type Smoothing } from './params';

/** Changed whenever the parameters change meaning, so an older tuning never overrides new defaults. */
const STORAGE_KEY = 'tweakpad:autopilot-params:5';

/** The defaults, with whatever was tuned in this browser last. */
export function autopilotParams(): AutopilotParams {
  return storedParams(STORAGE_KEY, DEFAULT_AUTOPILOT_PARAMS);
}

const smoothing = (folder: FolderApi, title: string, values: Smoothing) => {
  const group = folder.addFolder({ title, expanded: false });
  group.addBinding(values, 'radius', { min: 0, max: 200, step: 1 });
  group.addBinding(values, 'tension', { min: 0, max: 1, step: 0.01 });
  group.addBinding(values, 'sway', { min: 0, max: 30, step: 0.5 });
  group.addBinding(values, 'wavelength', { min: 80, max: 1200, step: 10 });
};

/** Adds the autopilot's section over `params`, edited in place; `apply` gets them after every change. */
export function tuneAutopilot(params: AutopilotParams, apply: (params: AutopilotParams) => void) {
  return addSection({
    key: STORAGE_KEY,
    title: 'Autopilot',
    params,
    defaults: DEFAULT_AUTOPILOT_PARAMS,
    literal: { name: 'DEFAULT_AUTOPILOT_PARAMS', type: 'AutopilotParams' },
    expanded: true,
    apply,
    build(folder) {
      folder.addBinding(params, 'enabled');
      folder.addBinding(params.debug, 'enabled', { label: 'debug' });

      const timing = folder.addFolder({ title: 'Timing', expanded: false });
      timing.addBinding(params.timing, 'interval', { min: 1, max: 20, step: 0.1 });
      timing.addBinding(params.timing, 'variance', { min: 0, max: 10, step: 0.1 });
      timing.addBinding(params.timing, 'idle', { label: 'resume after', min: 0.5, max: 30, step: 0.5 });

      const target = folder.addFolder({ title: 'Target', expanded: false });
      target.addBinding(params.target, 'minDistance', { label: 'min distance', min: 0, max: 6000, step: 10 });
      target.addBinding(params.target, 'maxDistance', { label: 'max distance', min: 200, max: 10000, step: 10 });

      const route = folder.addFolder({ title: 'Route', expanded: false });
      route.addBinding(params.route, 'clearance', { min: 0, max: 60, step: 1 });
      route.addBinding(params.route, 'angle', { min: 0, max: 80, step: 1 });
      route.addBinding(params.route, 'approach', { min: 40, max: 400, step: 1 });
      route.addBinding(params.route, 'spread', { min: 0, max: 1, step: 0.01 });
      route.addBinding(params.route, 'variety', { min: 0, max: 1, step: 0.01 });

      smoothing(folder, 'Endings', params.endings);
      smoothing(folder, 'Corners', params.halls);

      const head = folder.addFolder({ title: 'Head', expanded: false });
      head.addBinding(params.head, 'speed', { min: 50, max: 5000, step: 10 });
      head.addBinding(params.head, 'acceleration', { min: 100, max: 10000, step: 10 });
      head.addBinding(params.head, 'cornering', { min: 200, max: 20000, step: 50 });
      head.addBinding(params.head, 'impact', { label: 'impact speed', min: 0.3, max: 8, step: 0.05 });
      head.addBinding(params.head, 'runUp', { label: 'run-up', min: 0, max: 1200, step: 10 });
      head.addBinding(params.head, 'windup', { label: 'wind-up', min: 0.05, max: 1, step: 0.01 });

      const camera = folder.addFolder({ title: 'Camera', expanded: false });
      camera.addBinding(params.camera, 'frequency', { min: 0.5, max: 10, step: 0.05 });
      camera.addBinding(params.camera, 'damping', { min: 0.2, max: 1.5, step: 0.01 });
      camera.addBinding(params.camera, 'lead', { min: 0, max: 1.5, step: 0.01 });
      camera.addBinding(params.camera, 'focusFrequency', { label: 'focus frequency', min: 0.5, max: 10, step: 0.05 });
      camera.addBinding(params.camera, 'overshoot', { min: 0, max: 0.4, step: 0.005 });
      camera.addBinding(params.camera, 'blend', { min: 0.05, max: 3, step: 0.05 });
      camera.addBinding(params.camera, 'drift', { min: 0, max: 40, step: 0.5 });
      camera.addBinding(params.camera, 'driftRate', { label: 'drift rate', min: 0.02, max: 2, step: 0.01 });

      const trail = folder.addFolder({ title: 'Trail', expanded: false });
      trail.addBinding(params.trail, 'strength', { min: 0, max: 3, step: 0.01 });
      trail.addBinding(params.trail, 'carry', { min: 0, max: 1, step: 0.01 });
      trail.addBinding(params.trail, 'impact', { min: 0, max: 4, step: 0.05 });

      const debug = folder.addFolder({ title: 'Debug layers', expanded: false });
      debug.addBinding(params.debug, 'obstacles');
      debug.addBinding(params.debug, 'route');
      debug.addBinding(params.debug, 'path');
      debug.addBinding(params.debug, 'agents');
    },
  });
}
