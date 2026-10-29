/*
 * The fluid's section of the tuning panel (lib/tuning.ts), over its parameters (params.ts).
 */
import { addSection, storedParams } from '../tuning';
import { DEFAULT_PARAMS, type FluidParams } from './params';

/** Changed whenever the parameters change meaning, so an older tuning never overrides new defaults. */
const STORAGE_KEY = 'tweakpad:fluid-params:2';

/** The defaults, with whatever was tuned in this browser last. */
export function fluidParams(): FluidParams {
  return storedParams(STORAGE_KEY, DEFAULT_PARAMS);
}

/** Adds the fluid's section over `params`, edited in place; `apply` gets them after every change. */
export function tuneFluid(params: FluidParams, apply: (params: FluidParams) => void) {
  return addSection({
    key: STORAGE_KEY,
    title: 'Fluid',
    params,
    defaults: DEFAULT_PARAMS,
    literal: { name: 'DEFAULT_PARAMS', type: 'FluidParams' },
    apply,
    build(folder) {
      const lights = folder.addFolder({ title: 'Lights', expanded: false });
      lights.addBinding(params.lights, 'exposure', { min: 0, max: 5, step: 0.01 });
      lights.addBinding(params.lights, 'opacity', { min: 0, max: 1, step: 0.01 });
      lights.addBinding(params.lights, 'vignette', { min: 0, max: 1, step: 0.01 });
      lights.addBinding(params.lights, 'persistence', { label: 'linger', min: 0.9, max: 0.999, step: 0.001 });

      const pressure = folder.addFolder({ title: 'Pressure', expanded: false });
      pressure.addBinding(params.pressure, 'gain', { min: 0, max: 10, step: 0.01 });
      pressure.addBinding(params.pressure, 'suction', { min: 0, max: 1, step: 0.01 });
      pressure.addBinding(params.pressure, 'afterglow', { min: 0, max: 0.99, step: 0.01 });
      pressure.addBinding(params.pressure, 'curve', { min: 0.2, max: 2, step: 0.01 });
      pressure.addBinding(params.pressure, 'rim', { min: 0, max: 10, step: 0.05 });
      pressure.addBinding(params.pressure, 'rimWidth', { label: 'rim width', min: 1, max: 120, step: 1 });
      pressure.addBinding(params.pressure, 'halo', { min: 0, max: 3, step: 0.01 });
      pressure.addBinding(params.pressure, 'wake', { min: 0, max: 20, step: 0.1 });

      const flow = folder.addFolder({ title: 'Flow', expanded: false });
      flow.addBinding(params.flow, 'persistence', { label: 'momentum', min: 0.9, max: 0.999, step: 0.001 });
      flow.addBinding(params.flow, 'vorticity', { min: 0, max: 60, step: 0.5 });
      flow.addBinding(params.flow, 'pressureIterations', { label: 'pressure steps', min: 1, max: 30, step: 1 });

      const pointer = folder.addFolder({ title: 'Pointer', expanded: false });
      pointer.addBinding(params.pointer, 'dye', { min: 0, max: 2, step: 0.01 });
      pointer.addBinding(params.pointer, 'force', { min: 0, max: 3, step: 0.01 });
      pointer.addBinding(params.pointer, 'size', { min: 0.0002, max: 0.02, step: 0.0002 });

      const cards = folder.addFolder({ title: 'Cards', expanded: false });
      cards.addBinding(params.cards, 'resting', { label: 'resting wall', min: 0, max: 1, step: 0.01 });
      cards.addBinding(params.cards, 'swellPush', { label: 'swell push', min: 0, max: 20, step: 0.1 });
      cards.addBinding(params.cards, 'swellBand', { label: 'swell band', min: 0, max: 10, step: 0.1 });

      const fog = folder.addFolder({ title: 'Fog', expanded: false });
      fog.addBinding(params.fog, 'cards', { label: 'over cards', min: 0, max: 1, step: 0.01 });
      fog.addBinding(params.fog, 'background', { label: 'over stage', min: 0, max: 1, step: 0.01 });
    },
  });
}
