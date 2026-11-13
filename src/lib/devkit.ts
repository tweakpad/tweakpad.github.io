import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getCollection, type CollectionEntry } from 'astro:content';
import { url } from './url';

/**
 * DevKit (`@tweakpad/devkit`), the tweak panel built on the library. Its pages and their API
 * Reference come from the installed package: the pages from `docs/<section>/<slug>.mdx`, the
 * declarations and the page order from `docs.json`. The site only renders them.
 */
export type DevkitEntry = CollectionEntry<'devkit'>;

/** One row of a declaration's API: an option, property, event, method or type. */
export interface DevkitApiRow {
  name: string;
  type?: string;
  default?: string;
  description?: string;
  optional?: boolean;
  readonly?: boolean;
}
/** A class, interface or type alias the pages document, as `docs.json` lists it. */
export interface DevkitDeclaration {
  name: string;
  kind: 'class' | 'interface' | 'type';
  description?: string;
  options: DevkitApiRow[];
  properties: DevkitApiRow[];
  events: DevkitApiRow[];
  methods: DevkitApiRow[];
  type: DevkitApiRow[];
}
interface DevkitIndex {
  version: string;
  pages: { id: string; section: string; title: string }[];
  api: Record<string, DevkitDeclaration>;
}

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(require.resolve('@tweakpad/devkit/package.json'), 'utf8')) as {
  version: string;
  description: string;
};
const index = JSON.parse(readFileSync(require.resolve('@tweakpad/devkit/docs.json'), 'utf8')) as DevkitIndex;

export const devkitVersion = packageJson.version;
export const devkitDescription = packageJson.description;
export const DEVKIT_REPOSITORY = 'https://github.com/tweakpad/devkit';

/** A declaration's API, or undefined when the index has no entry for it. */
export const devkitApi = (name: string): DevkitDeclaration | undefined => index.api[name];

/** The sections in the order the package's index lists them, each labelled from its folder. */
const SECTION_LABELS: Record<string, string> = {
  pane: 'Pane',
  controls: 'Controls',
  monitoring: 'Monitoring',
  history: 'History',
};
const sectionLabel = (id: string) => SECTION_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');

export const devkitPath = (entry: DevkitEntry) => `/devkit/${entry.id}`;

/** DevKit's pages by section, both in the index's order (pages the index lacks go last). */
export async function devkitSections() {
  const entries = await getCollection('devkit');
  const rank = (id: string) => {
    const at = index.pages.findIndex((page) => page.id === id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  const sorted = entries.sort((a, b) => rank(a.id) - rank(b.id) || a.data.title.localeCompare(b.data.title));
  const ids = [...new Set(sorted.map((entry) => entry.id.split('/')[0]!))];
  return ids.map((id) => ({
    id,
    label: sectionLabel(id),
    entries: sorted.filter((entry) => entry.id.split('/')[0] === id),
  }));
}

/** The docs shell's section for DevKit: its landing page, side navigation and sidebar. */
export async function devkitSection() {
  return {
    name: 'DevKit',
    path: '/devkit',
    navLabel: 'DevKit',
    persist: 'devkit-sidebar',
    groups: (await devkitSections()).map((section) => ({
      id: section.id,
      label: section.label,
      items: section.entries.map((entry) => ({ id: entry.id, title: entry.data.title, href: url(devkitPath(entry)) })),
    })),
  };
}
