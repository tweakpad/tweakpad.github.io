import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Docs: getting-started guides, one page per foundational component, and opt-in widgets. */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(100),
    /** Custom element whose API table the page shows, read from the package manifest. */
    tag: z.string().optional(),
    /** Further elements of the same component (for example `tp-accordion-item`), each with its own API table. */
    parts: z.array(z.string()).default([]),
    /**
     * Path of the library's reference doc under `docs/` without `.md`, when it differs from the
     * page slug; `false` when the library has no reference doc for this component.
     */
    reference: z.union([z.string(), z.literal(false)]).optional(),
    /**
     * Also lists the element's own properties without an attribute and its methods, for elements
     * driven mostly from script. Off by default: some elements expose many undescribed members.
     */
    members: z.boolean().default(false),
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
    /** Docs component ids (for example `button`) this pattern is built from. */
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

export const collections = { docs, patterns, kits };
