import type { APIRoute } from 'astro';
import { sortedPatterns } from '../lib/content';
import { DEVKIT_REPOSITORY, devkitDescription, devkitSections } from '../lib/devkit';
import { devkitUrl, docSections, docUrl, patternUrl, preamble } from '../lib/llms';
import { REPOSITORY, absolute } from '../lib/seo';

/** The documentation index for language models (llmstxt.org): every page, with what it covers. */
export const GET: APIRoute = async () => {
  const link = (title: string, url: string, description: string) => `- [${title}](${url}): ${description}`;
  const sections = (await docSections()).map(
    (section) => `## ${section.label}\n\n${section.entries.map((entry) => link(entry.data.title, docUrl(entry), entry.data.description)).join('\n')}`,
  );
  const patterns = (await sortedPatterns()).map((pattern) => link(pattern.data.title, patternUrl(pattern), pattern.data.description));
  const devkit = (await devkitSections()).flatMap((section) =>
    section.entries.map((entry) => link(`${section.label}: ${entry.data.title}`, devkitUrl(entry), entry.data.description)),
  );
  const body = [
    preamble().trimEnd(),
    `Every page below, with its API reference, is also available as one Markdown file: ${absolute('/llms-full.txt')}`,
    ...sections,
    `## Patterns\n\nCopyable compositions of several components into a complete screen.\n\n${patterns.join('\n')}`,
    `## DevKit\n\n\`@tweakpad/devkit\` is a separate package built on the library. ${devkitDescription} Install it with \`npm install @tweakpad/devkit\` and create a \`Pane\`.\n\n${[link('DevKit', absolute('/devkit'), 'install, quick start and how it stays fast'), ...devkit].join('\n')}`,
    `## Optional\n\n${[
      link('Full documentation', absolute('/llms-full.txt'), 'every page above in one Markdown file, with API reference tables'),
      link('Source', REPOSITORY, 'the @tweakpad/ui repository'),
      link('DevKit source', DEVKIT_REPOSITORY, 'the @tweakpad/devkit repository'),
    ].join('\n')}`,
  ].join('\n\n');
  return new Response(`${body}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
