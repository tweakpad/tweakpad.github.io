import { getCollection, type CollectionEntry } from 'astro:content';
import { usedBy } from './manifest';

/** A docs page: a getting-started guide, or a component or widget page from the package. */
export type DocEntry = CollectionEntry<'docs'> | CollectionEntry<'library'>;
export type PatternEntry = CollectionEntry<'patterns'>;
export type KitEntry = CollectionEntry<'kits'>;

const byOrder = (a: { data: { order: number; title: string } }, b: typeof a) =>
  a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);

/** Docs ids look like `components/button`; the group is the folder. */
export const docGroup = (entry: DocEntry) => entry.id.split('/')[0] ?? '';
export const docSlug = (entry: DocEntry) => entry.id.split('/').slice(1).join('/');

/** The introduction is the Docs landing page, so it lives at `/docs` rather than under its id. */
export const INTRO_ID = 'getting-started/introduction';
export const docPath = (entry: DocEntry) => (entry.id === INTRO_ID ? '/docs' : `/docs/${entry.id}`);

export const DOC_GROUPS = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'components', label: 'Components' },
  { id: 'widgets', label: 'Widgets' },
] as const;

/** Groups whose entries document one component each, with an API reference and related patterns. */
export const isComponentDoc = (entry: DocEntry) =>
  docGroup(entry) === 'components' || docGroup(entry) === 'widgets';

/** Every docs page: the site's guides, then the package's component and widget pages. */
export const allDocs = async (): Promise<DocEntry[]> => [
  ...(await getCollection('docs')),
  ...(await getCollection('library')),
];

export async function docsByGroup() {
  const entries = (await allDocs()).sort(byOrder);
  return DOC_GROUPS.map((group) => ({
    ...group,
    entries:
      group.id !== 'getting-started'
        ? entries
            .filter((entry) => docGroup(entry) === group.id)
            .sort((a, b) => a.data.title.localeCompare(b.data.title))
        : entries.filter((entry) => docGroup(entry) === group.id),
  }));
}

export const sortedPatterns = async () => (await getCollection('patterns')).sort(byOrder);
export const sortedKits = async () => (await getCollection('kits')).sort(byOrder);

/** Patterns that compose the given component, shown on that component's page. */
export async function patternsUsing(componentId: string) {
  return (await sortedPatterns()).filter((pattern) =>
    pattern.data.components.includes(componentId),
  );
}

/** Component and widget pages a pattern is built from, in the pattern's order. */
export async function componentsOf(pattern: PatternEntry) {
  const docs = await getCollection('library');
  return pattern.data.components
    .map((id) => docs.find((entry) => entry.id === `components/${id}` || entry.id === `widgets/${id}`))
    .filter((entry): entry is CollectionEntry<'library'> => Boolean(entry));
}

export const featuredPatterns = async () =>
  (await sortedPatterns()).filter((pattern) => pattern.data.featured);

export type RelatedEntry =
  | { kind: 'doc'; entry: CollectionEntry<'library'> }
  | { kind: 'pattern'; pattern: PatternEntry };

/**
 * A component or widget page's Related entries: the pages whose elements render it (from the
 * package's docs index), then the patterns built from it. Empty when nothing uses it.
 */
export async function relatedOf(id: string): Promise<RelatedEntry[]> {
  const library = await getCollection('library');
  const pages = usedBy(id)
    .map((pageId) => library.find((entry) => entry.id === pageId))
    .filter((entry) => entry !== undefined);
  const patterns = await patternsUsing(id.split('/')[1] ?? '');
  return [
    ...pages.map((entry) => ({ kind: 'doc' as const, entry })),
    ...patterns.map((pattern) => ({ kind: 'pattern' as const, pattern })),
  ];
}
