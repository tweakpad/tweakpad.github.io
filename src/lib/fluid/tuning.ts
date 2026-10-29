/*
 * A Tweakpane panel over the home page's fluid (params.ts). Every change applies live and is kept
 * in this browser, so a tuned look survives reloads; "Copy values" puts the set on the clipboard
 * as a DEFAULT_PARAMS literal, to paste over the one in params.ts, and "Reset" goes back to the
 * defaults. The home page opens it in development, or anywhere with ?tune in the address.
 */
import { Pane, type ButtonApi } from 'tweakpane';

import { assignParams, cloneParams, DEFAULT_PARAMS, type FluidParams, type LightParams } from './params';

const STORAGE_KEY = 'tweakpad:fluid-params';

/** The defaults, with whatever was tuned in this browser last. */
export function storedParams(): FluidParams {
  const params = cloneParams();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) assignParams(params, JSON.parse(stored));
  } catch {
    // Storage may be blocked, or hold something unreadable; the defaults serve.
  }
  return params;
}

function store(params: FluidParams) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Without storage the tuning lasts until the page reloads.
  }
}

/** `params` as TypeScript, rounded past what the sliders can set. */
function literal(params: FluidParams) {
  const json = JSON.stringify(
    params,
    (_, value: unknown) => (typeof value === 'number' ? Number(value.toFixed(4)) : value),
    2,
  );
  return `export const DEFAULT_PARAMS: FluidParams = ${json.replace(/"(\w+)":/g, '$1:')};\n`;
}

/** Shows `message` on a button for a moment. */
function flash(button: ButtonApi, message: string) {
  const title = button.title;
  button.title = message;
  setTimeout(() => (button.title = title), 1200);
}

/**
 * Opens the panel over `params`, which it edits in place; `apply` gets them after every change.
 * Returns the panel's disposal.
 */
export function mountTuning(params: FluidParams, apply: (params: FluidParams) => void) {
  const container = document.createElement('div');
  container.style.cssText = [
    'position: fixed',
    'z-index: 30',
    'inset-block-end: 16px',
    'inset-inline-end: 16px',
    'inline-size: min(300px, calc(100vw - 32px))',
    'max-block-size: calc(100dvh - 32px)',
    'overflow-y: auto',
  ].join(';');
  document.body.append(container);
  const pane = new Pane({ container, title: 'Fluid' });

  const lights = pane.addFolder({ title: 'Lights' });
  lights.addBinding(params.lights, 'exposure', { min: 0, max: 5, step: 0.01 });
  lights.addBinding(params.lights, 'opacity', { min: 0, max: 1, step: 0.01 });
  lights.addBinding(params.lights, 'vignette', { min: 0, max: 1, step: 0.01 });
  lights.addBinding(params.lights, 'persistence', { label: 'linger', min: 0.9, max: 0.999, step: 0.001 });

  const light = (title: string, values: LightParams) => {
    const folder = pane.addFolder({ title, expanded: false });
    folder.addBinding(values, 'color', { color: { type: 'float' } });
    folder.addBinding(values, 'strength', { min: 0, max: 0.5, step: 0.005 });
    folder.addBinding(values, 'size', { min: 0.0005, max: 0.03, step: 0.0005 });
  };
  light('Light A', params.lightA);
  light('Light B', params.lightB);

  const motion = pane.addFolder({ title: 'Motion', expanded: false });
  motion.addBinding(params.motion, 'speed', { min: 0, max: 4, step: 0.01 });
  motion.addBinding(params.motion, 'orbit', { min: 0, max: 2, step: 0.01 });
  motion.addBinding(params.motion, 'centerX', { label: 'center x', min: 0, max: 1, step: 0.01 });
  motion.addBinding(params.motion, 'centerY', { label: 'center y', min: 0, max: 1, step: 0.01 });
  motion.addBinding(params.motion, 'push', { min: 0, max: 10, step: 0.1 });
  motion.addBinding(params.motion, 'swirl', { min: 0, max: 10, step: 0.1 });

  const flow = pane.addFolder({ title: 'Flow', expanded: false });
  flow.addBinding(params.flow, 'persistence', { label: 'momentum', min: 0.9, max: 0.999, step: 0.001 });
  flow.addBinding(params.flow, 'vorticity', { min: 0, max: 60, step: 0.5 });
  flow.addBinding(params.flow, 'pressureIterations', { label: 'pressure steps', min: 1, max: 30, step: 1 });
  flow.addBinding(params.flow, 'pressureGlow', { label: 'pressure glow', min: 0, max: 20, step: 0.1 });

  const pointer = pane.addFolder({ title: 'Pointer', expanded: false });
  pointer.addBinding(params.pointer, 'dye', { min: 0, max: 2, step: 0.01 });
  pointer.addBinding(params.pointer, 'force', { min: 0, max: 3, step: 0.01 });
  pointer.addBinding(params.pointer, 'size', { min: 0.0002, max: 0.02, step: 0.0002 });

  const cards = pane.addFolder({ title: 'Cards', expanded: false });
  cards.addBinding(params.cards, 'resting', { label: 'resting wall', min: 0, max: 1, step: 0.01 });
  cards.addBinding(params.cards, 'swellPush', { label: 'swell push', min: 0, max: 20, step: 0.1 });
  cards.addBinding(params.cards, 'swellBand', { label: 'swell band', min: 0, max: 10, step: 0.1 });

  const fog = pane.addFolder({ title: 'Fog' });
  fog.addBinding(params.fog, 'cards', { label: 'over cards', min: 0, max: 1, step: 0.01 });
  fog.addBinding(params.fog, 'background', { label: 'over stage', min: 0, max: 1, step: 0.01 });

  const changed = () => {
    store(params);
    apply(params);
  };
  pane.on('change', changed);

  const copy = pane.addButton({ title: 'Copy values' });
  copy.on('click', () => {
    const text = literal(params);
    console.info(text);
    navigator.clipboard.writeText(text).then(
      () => flash(copy, 'Copied'),
      () => flash(copy, 'Copy failed, see the console'),
    );
  });
  pane.addButton({ title: 'Reset' }).on('click', () => {
    assignParams(params, DEFAULT_PARAMS);
    pane.refresh();
    changed();
  });

  return () => {
    pane.dispose();
    container.remove();
  };
}
