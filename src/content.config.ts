import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Docs written for the site: the getting-started guides. */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(100),
    /** The page ends with the package's design token list (`TokenList.astro`), one section per family. */
    tokens: z.boolean().default(false),
  }),
});

/**
 * One page per component and widget, read from the installed `@tweakpad/ui` package, where each
 * page is written once (`docs/components/<slug>.mdx`, `docs/motion/<group>/<slug>.mdx`,
 * `docs/widgets/<slug>.mdx`). The site renders them with its own components and never authors
 * them; their API tables come from the same package, so a page always describes the version the
 * site is built against.
 */
const libraryRoot = dirname(createRequire(import.meta.url).resolve('@tweakpad/ui/package.json'));
const library = defineCollection({
  loader: glob({ pattern: '{components,motion/text,motion/surface,widgets}/*.mdx', base: join(libraryRoot, 'docs') }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(100),
    /** The element the page documents. */
    tag: z.string(),
    /** Further elements of the same component (for example `tp-accordion-item`), each with its own API tables. */
    parts: z.array(z.string()).default([]),
  }),
});

/** Patterns: copyable compositions of several components, such as a sign-in screen. */
const patterns = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/patterns' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(100),
    category: z.string(),
    /** Shown on the home page canvas. Only reviewed, real-scenario compositions are featured. */
    featured: z.boolean().default(false),
    /** The composition: rendered live on the pattern page and the home canvas, and the copyable code. */
    example: z.string(),
    /** Component or widget page slugs (for example `button`) this pattern is built from. */
    components: z.array(z.string()),
  }),
});

/** Kits: niche controls, compositions and a theme for one kind of product. */
const kits = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/kits' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(100),
    status: z.enum(['planned', 'preview', 'stable']),
    /** The kit's accent, used on its card and page header. */
    accent: z.string(),
    controls: z.array(z.object({ name: z.string(), description: z.string() })),
  }),
});

export const collections = { docs, library, patterns, kits };
