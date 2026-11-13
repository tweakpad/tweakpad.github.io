// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { init, parse } from 'es-module-lexer';

/**
 * One registration module per library element, so a page defines only the elements it uses.
 *
 * `@tweakpad/ui` exports every element class and `defineElement` without side effects, and
 * `defineElement` also defines the library elements a class renders (its `elementDependencies`).
 * `virtual:tp-element/<tag>` imports one class and exports a function that defines it; the bundler
 * keeps only that class's modules. `virtual:tp-elements` maps every tag to a loader of its module (`src/lib/elements.ts`).
 *
 * Tags and classes come from the package's `custom-elements.json`; the entry that exports each
 * class, from the export lists of `@tweakpad/ui` and `@tweakpad/ui/widgets`. A tag neither entry
 * exports is left out: the library defines it through the element that renders it.
 */
const MAP_ID = 'virtual:tp-elements';
const ELEMENT_PREFIX = 'virtual:tp-element/';
/** Resolved ids end in the tag and `.js`, so the bundler names each element's chunk after its tag. */
const RESOLVED_MAP = '\0tp-elements.js';
const RESOLVED_ELEMENT = '\0tp-element/';
const PREVIEW_PREFIX = 'virtual:tp-preview/';
/**
 * Packages resolve from the project root, where builds run (npm scripts and CI): Preview.astro
 * imports this file from Astro's prerender bundle, where `import.meta.url` is elsewhere.
 */
const require = createRequire(join(process.cwd(), 'package.json'));

/** The names a barrel entry exports, read from its built module. @param {string} entry */
async function exportsOf(entry) {
  await init();
  const root = dirname(require.resolve('@tweakpad/ui/package.json'));
  const file = { '@tweakpad/ui': 'index.js', '@tweakpad/ui/widgets': 'widgets.js' }[entry];
  if (!file) throw new Error(`${entry} is not a barrel entry`);
  const names = new Set();
  for (const exported of parse(readFileSync(join(root, 'dist', file), 'utf8'))[1]) {
    // A star re-export would hide its names from this list; the barrels list each name.
    if (!('name' in exported)) throw new Error(`${entry} re-exports a module wholesale; its names cannot be listed`);
    names.add(exported.name);
  }
  return names;
}

/** @returns {Promise<Map<string, { name: string, entry: string }>>} tag → class and the entry exporting it */
async function libraryElements() {
  const root = dirname(require.resolve('@tweakpad/ui/package.json'));
  const entries = [
    { entry: '@tweakpad/ui', names: await exportsOf('@tweakpad/ui') },
    { entry: '@tweakpad/ui/widgets', names: await exportsOf('@tweakpad/ui/widgets') },
  ];
  const manifest = JSON.parse(readFileSync(join(root, 'dist', 'custom-elements.json'), 'utf8'));
  const elements = new Map();
  for (const module of manifest.modules ?? []) {
    for (const declaration of module.declarations ?? []) {
      if (!declaration.tagName) continue;
      const source = entries.find(({ names }) => names.has(declaration.name));
      if (source) elements.set(declaration.tagName, { name: declaration.name, entry: source.entry });
    }
  }
  if (elements.size === 0) throw new Error('No @tweakpad/ui element was found in custom-elements.json and the package exports');
  return elements;
}

/**
 * The order `@tweakpad/ui/register` defines its elements in: its `defineElement(X.tagName, X)`
 * calls, with each local name traced to its class through register.js's imports. The loader
 * defines a batch in this order, the one every element was written and tested against.
 * @returns {string[]} class names
 */
function registerOrder() {
  const source = readFileSync(join(dirname(require.resolve('@tweakpad/ui/package.json')), 'dist', 'register.js'), 'utf8');
  const classOf = new Map();
  for (const [, names] of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const binding of names.split(',')) {
      const [imported, local = imported] = binding.trim().split(/\s+as\s+/);
      if (imported) classOf.set(local, imported);
    }
  }
  const order = [...source.matchAll(/[\w$]+\(([\w$]+)\.tagName,\s*\1\)/g)].map(([, local]) => classOf.get(local));
  if (order.length === 0 || order.includes(undefined)) throw new Error('The definition order of @tweakpad/ui/register.js could not be read');
  return order;
}

/**
 * The names preview scripts import from the library's two barrel entries.
 *
 * Preview scripts read their modules from the site's bundle (`Preview.astro`). Handing them
 * `import('@tweakpad/ui')` would keep that barrel, and so every module it re-exports, in the
 * bundle as one unit: each element chunk imports its class through the barrel, so every page would
 * load the whole library. `virtual:tp-preview/<entry>` re-exports only these names instead.
 *
 * Every file a Preview can be written in is read: the library's and DevKit's pages and the site's
 * own sources. `Preview.astro` fails the build when a script imports a name missing here.
 */
export const PREVIEW_ENTRIES = /** @type {const} */ (['@tweakpad/ui', '@tweakpad/ui/widgets']);
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*\\?['"](@tweakpad\/ui(?:\/widgets)?)\\?['"]/g;
/** @type {Map<string, Set<string>> | undefined} */
let previewNames;
export function previewImports() {
  if (previewNames) return previewNames;
  const roots = [
    join(dirname(require.resolve('@tweakpad/ui/package.json')), 'docs'),
    join(dirname(require.resolve('@tweakpad/devkit/package.json')), 'docs'),
    join(process.cwd(), 'src'),
  ];
  previewNames = new Map(PREVIEW_ENTRIES.map((entry) => [entry, new Set()]));
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.(mdx?|astro|ts)$/.test(entry.name)) continue;
      const source = readFileSync(join(entry.parentPath, entry.name), 'utf8');
      for (const [, names, specifier] of source.matchAll(NAMED_IMPORT)) {
        for (const name of names.split(',')) {
          const imported = name.trim().split(/\s+as\s+/)[0];
          // `import { type A }` brings no value.
          if (imported && !imported.startsWith('type ')) previewNames.get(specifier)?.add(imported);
        }
      }
    }
  }
  return previewNames;
}

/** @returns {import('vite').Plugin} */
export default function libraryElementsPlugin() {
  /** @type {Promise<Map<string, { name: string, entry: string }>> | undefined} */
  let elements;
  const load = () => (elements ??= libraryElements());
  return {
    name: 'tweakpad:library-elements',
    resolveId(id) {
      if (id === MAP_ID) return RESOLVED_MAP;
      if (id.startsWith(ELEMENT_PREFIX)) return `${RESOLVED_ELEMENT}${id.slice(ELEMENT_PREFIX.length)}.js`;
      if (id.startsWith(PREVIEW_PREFIX)) return `\0${id}`;
    },
    async load(id) {
      if (id.startsWith(`\0${PREVIEW_PREFIX}`)) {
        const entry = id.slice(PREVIEW_PREFIX.length + 1);
        const names = [...(previewImports().get(entry) ?? [])].sort();
        const exported = await exportsOf(entry);
        const missing = names.filter((name) => !exported.has(name));
        if (missing.length) throw new Error(`${entry} does not export ${missing.join(', ')}, which a preview script imports`);
        return names.length ? `export { ${names.join(', ')} } from '${entry}';\n` : 'export {};\n';
      }
      if (id === RESOLVED_MAP) {
        const elements = await load();
        const rank = new Map(registerOrder().map((name, index) => [name, index]));
        // register.js's order first; elements it does not define (the widgets) after, as listed.
        const place = (/** @type {string} */ tag) => rank.get(elements.get(tag)?.name ?? '') ?? rank.size;
        const tags = [...elements.keys()].sort((a, b) => place(a) - place(b));
        const rows = tags.map((tag) => `  ${JSON.stringify(tag)}: () => import(${JSON.stringify(ELEMENT_PREFIX + tag)}),`);
        return `export default {\n${rows.join('\n')}\n};\nexport const order = ${JSON.stringify(tags)};\n`;
      }
      if (id.startsWith(RESOLVED_ELEMENT)) {
        const tag = id.slice(RESOLVED_ELEMENT.length, -'.js'.length);
        const element = (await load()).get(tag);
        if (!element) throw new Error(`${tag} is not an element @tweakpad/ui exports`);
        return [
          `import { defineElement } from '@tweakpad/ui';`,
          `import { ${element.name} } from '${element.entry}';`,
          // Defined by the loader with the rest of its batch, not on import (lib/elements.ts).
          `export default () => defineElement(${element.name}.tagName, ${element.name});`,
          '',
        ].join('\n');
      }
    },
  };
}
