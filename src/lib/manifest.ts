import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { elementApi as manifestApi, type DocsIndex, type ElementApi, type Manifest } from '@tweakpad/ui/docs';

/**
 * The installed package's Custom Elements Manifest and documentation index, so component pages
 * always describe the version of @tweakpad/ui the site is built against. The rows come from the
 * library's own filter (`elementApi`), the one Storybook prints too; the site only renders them.
 */
const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@tweakpad/ui/package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  version: string;
  customElements: string;
};
const manifest = JSON.parse(
  readFileSync(join(dirname(packageJsonPath), packageJson.customElements), 'utf8'),
) as Manifest;
const docsIndex = JSON.parse(
  readFileSync(require.resolve('@tweakpad/ui/docs.json'), 'utf8'),
) as DocsIndex;

export const uiVersion = packageJson.version;

export type { ElementApi };

/** The API rows of one element: attributes, properties, events, then methods, slots, parts and CSS properties. */
export const elementApi = (tagName: string): ElementApi | undefined => manifestApi(manifest, tagName);

/** Page ids (`components/button`) of the components and widgets that render the given page's elements. */
export const usedBy = (pageId: string): readonly string[] =>
  docsIndex.pages.find((page) => page.id === pageId)?.related.renderedBy ?? [];

/** The design token families of the installed package, with every role and what it is for. */
export const tokenFamilies = docsIndex.tokens;

/** The section id of a token family on the Design tokens page (`fontSize` → `tokens-font-size`). */
export const familyId = (family: string) =>
  `tokens-${family.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
