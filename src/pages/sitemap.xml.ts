import type { APIRoute } from 'astro';
import { INTRO_ID, allDocs, docPath, sortedPatterns } from '../lib/content';
import { absolute } from '../lib/seo';

/** Every page of the site, for search engines. Redirects and the 404 page are left out. */
export const GET: APIRoute = async () => {
  const paths = [
    '/',
    '/docs',
    ...(await allDocs()).filter((entry) => entry.id !== INTRO_ID).map(docPath),
    '/patterns',
    ...(await sortedPatterns()).map((pattern) => `/patterns/${pattern.id}`),
    '/kits',
  ];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${absolute(path)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
