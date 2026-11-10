import type { APIRoute } from 'astro';
import { sortedKits, sortedPatterns } from '../lib/content';
import { docSections, docUrl, patternUrl, preamble } from '../lib/llms';
import { REPOSITORY, absolute } from '../lib/seo';

/** The documentation index for language models (llmstxt.org): every page, with what it covers. */
export const GET: APIRoute = async () => {
  const link = (title: string, url: string, description: string) => `- [${title}](${url}): ${description}`;
  const sections = (await docSections()).map(
    (section) => `## ${section.label}\n\n${section.entries.map((entry) => link(entry.data.title, docUrl(entry), entry.data.description)).join('\n')}`,
  );
  const patterns = (await sortedPatterns()).map((pattern) => link(pattern.data.title, patternUrl(pattern), pattern.data.description));
  const kits = (await sortedKits()).map((kit) => `${kit.data.title} (${kit.data.status})`).join(', ');
  const body = [
    preamble().trimEnd(),
    `Every page below, with its API reference, is also available as one Markdown file: ${absolute('/llms-full.txt')}`,
    ...sections,
    `## Patterns\n\nCopyable compositions of several components into a complete screen.\n\n${patterns.join('\n')}`,
    `## Optional\n\n${[
      link('Full documentation', absolute('/llms-full.txt'), 'every page above in one Markdown file, with API reference tables'),
      link('Kits', absolute('/kits'), `specialized controls and themes for one kind of product, in progress: ${kits}`),
      link('Source', REPOSITORY, 'the @tweakpad/ui repository'),
    ].join('\n')}`,
  ].join('\n\n');
  return new Response(`${body}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
