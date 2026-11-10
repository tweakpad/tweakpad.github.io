import type { APIRoute } from 'astro';
import { sortedPatterns } from '../lib/content';
import { docMarkdown, docSections, patternMarkdown, preamble } from '../lib/llms';

/** The whole documentation for language models, as one Markdown file, in site order. */
export const GET: APIRoute = async () => {
  const docs = (await docSections()).flatMap((section) => section.entries);
  const pages = [
    ...(await Promise.all(docs.map(docMarkdown))),
    ...(await Promise.all((await sortedPatterns()).map(patternMarkdown))),
  ];
  const body = [preamble().trimEnd(), ...pages].join('\n\n---\n\n');
  return new Response(`${body}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
