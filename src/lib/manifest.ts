import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  elementApi as manifestApi,
  proseParts,
  reachedSymbols,
  signatureTokens,
  symbolCard,
  typeRefs,
  type ApiToken,
  type ProsePart,
  type ApiTypes,
  type DocsIndex,
  type ElementApi,
  type Manifest,
} from '@tweakpad/ui/docs';

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

/** The type cards the compiler read for the installed package (`@tweakpad/ui/api-types.json`). */
const types = JSON.parse(
  readFileSync(require.resolve('@tweakpad/ui/api-types.json'), 'utf8'),
) as ApiTypes;

export type { ApiToken, ProsePart };

/** The cards a page of `tag` carries (TypeCard): a link renders only when its card is among them. */
const carried = new Map<string, Set<string>>();
const carriedBy = (tag: string) => {
  let ids = carried.get(tag);
  if (!ids) carried.set(tag, (ids = new Set(reachedSymbols(types, [tag]))));
  return ids;
};
const linkable = <T extends { ref?: string }>(tag: string, part: T): T => {
  if (!part.ref || carriedBy(tag).has(part.ref)) return part;
  const { ref: _ref, ...plain } = part;
  return plain as T;
};

/** A signature of `tag` (a property type, an event type, a method) as tokens; type names carry their card. */
export const signature = (tag: string, code: string): ApiToken[] =>
  signatureTokens(types, tag, code).map((token) => linkable(tag, token));

/** A description of a row of `tag` as runs; a code span that names a type carries its card. */
export const prose = (tag: string, text: string): ProsePart[] =>
  proseParts(text, typeRefs(types, { tag })).map((part) => linkable(tag, part));

/** A card as the page sends it to the browser: its declaration as token lines, doc comment and import. */
export interface TypeCardData {
  name: string;
  kind: string;
  lines: ApiToken[][];
  /** The doc comment as runs; a code span that names a type carries its card. */
  documentation: ProsePart[];
  importLine?: string;
  /** A type of the platform (the DOM, the language): global, no import needed. */
  platform?: true;
}

/** The cards the signatures of `tags` reach, by id: the data a page's type card reads. */
export const typeCards = (tags: readonly string[]): Record<string, TypeCardData> =>
  Object.fromEntries(
    reachedSymbols(types, tags).map((id) => {
      const card = symbolCard(types, id)!;
      return [
        id,
        {
          name: card.name,
          kind: card.kind,
          lines: card.lines,
          documentation: proseParts(card.documentation, typeRefs(types, { symbol: id })),
          ...(card.importLine ? { importLine: card.importLine } : {}),
          ...(card.platform ? { platform: true as const } : {}),
        },
      ];
    }),
  );

/** The declarations the signatures of `tags` reach, as TypeScript, for the plain-text page. */
export const typeDeclarations = (tags: readonly string[]): string[] =>
  reachedSymbols(types, tags).map((id) => types.symbols[id]!.declaration);

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
