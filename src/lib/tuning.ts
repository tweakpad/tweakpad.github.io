/*
 * The home page's tuning panel: one Tweakpane for every effect on the stage. A feature adds a
 * section over its parameter set (params.ts), edited in place: every change applies live and is
 * kept in this browser under the section's key, so a tuned look survives reloads. Each section has
 * "Copy values", which puts its set on the clipboard as the defaults literal to paste back into
 * code, and "Reset". The panel exists only while a section does, and starts collapsed. It is for
 * development only: every section is imported behind `import.meta.env.DEV`, so production builds
 * leave this module, Tweakpane and the sections out.
 */
import { Pane, type ButtonApi, type FolderApi } from 'tweakpane';

import { assignParams, cloneParams } from './params';

export interface TuningSection<T extends object> {
  /** Where the tuning is kept; change it when the parameters change meaning. */
  key: string;
  title: string;
  /** The set the panel edits in place, usually from `storedParams`. */
  params: T;
  defaults: T;
  /** How "Copy values" names the literal: the defaults' constant and its type. */
  literal: { name: string; type: string };
  expanded?: boolean;
  /** Adds the section's controls, bound to `params`. */
  build(folder: FolderApi): void;
  /** Called with `params` after every change. */
  apply(params: T): void;
}

/** The defaults, with whatever was tuned under `key` in this browser last. */
export function storedParams<T extends object>(key: string, defaults: T): T {
  const params = cloneParams(defaults);
  try {
    const stored = localStorage.getItem(key);
    if (stored) assignParams(params, JSON.parse(stored));
  } catch {
    // Storage may be blocked, or hold something unreadable; the defaults serve.
  }
  return params;
}

function store(key: string, params: object) {
  try {
    localStorage.setItem(key, JSON.stringify(params));
  } catch {
    // Without storage the tuning lasts until the page reloads.
  }
}

/** `params` as TypeScript, rounded past what the sliders can set. */
function literal(params: object, { name, type }: TuningSection<object>['literal']) {
  const json = JSON.stringify(
    params,
    (_, value: unknown) => (typeof value === 'number' ? Number(value.toFixed(4)) : value),
    2,
  );
  return `export const ${name}: ${type} = ${json.replace(/"(\w+)":/g, '$1:')};\n`;
}

/** Shows `message` on a button for a moment. */
function flash(button: ButtonApi, message: string) {
  const title = button.title;
  button.title = message;
  setTimeout(() => (button.title = title), 1200);
}

let pane: { pane: Pane; container: HTMLElement; sections: number } | undefined;

function openPane() {
  if (pane) return pane;
  const container = document.createElement('div');
  container.style.cssText = [
    'position: fixed',
    'z-index: 30',
    'inset-block-end: 16px',
    'inset-inline-end: 16px',
    'inline-size: min(320px, calc(100vw - 32px))',
    'max-block-size: calc(100dvh - 32px)',
    'overflow-y: auto',
  ].join(';');
  document.body.append(container);
  pane = { pane: new Pane({ container, title: 'Tuning', expanded: false }), container, sections: 0 };
  return pane;
}

/** Adds a section to the panel, opening it if needed. Returns the section's removal. */
export function addSection<T extends object>(section: TuningSection<T>): () => void {
  const open = openPane();
  open.sections += 1;
  const folder = open.pane.addFolder({ title: section.title, expanded: section.expanded ?? false });
  section.build(folder);

  const changed = () => {
    store(section.key, section.params);
    section.apply(section.params);
  };
  folder.on('change', changed);

  const copy = folder.addButton({ title: 'Copy values' });
  copy.on('click', () => {
    const text = literal(section.params, section.literal);
    console.info(text);
    navigator.clipboard.writeText(text).then(
      () => flash(copy, 'Copied'),
      () => flash(copy, 'Copy failed, see the console'),
    );
  });
  folder.addButton({ title: 'Reset' }).on('click', () => {
    assignParams(section.params, section.defaults);
    folder.refresh();
    changed();
  });

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    folder.dispose();
    open.sections -= 1;
    if (open.sections === 0 && pane === open) {
      open.pane.dispose();
      open.container.remove();
      pane = undefined;
    }
  };
}
