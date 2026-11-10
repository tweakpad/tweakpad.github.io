import { url } from './url';

/** The site's name, as shown in titles, link previews and structured data. */
export const SITE_NAME = 'Tweakpad UI';
/** The site's one-line pitch: the home header's description. */
export const SITE_SUMMARY = 'A component library without the framework drama. Accessible, flexible and fully lit.';
export const REPOSITORY = 'https://github.com/tweakpad/ui';

/**
 * The absolute URL of a served path (base included). Pages end with a slash, as the `directory`
 * build format serves them; files (`/og.png`, `/llms.txt`) keep their name.
 */
export function served(path: string): string {
  const [pathname = '/', hash = ''] = path.split('#');
  const page = /\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith('/') ? pathname : `${pathname}/`;
  return new URL(page, import.meta.env.SITE).href + (hash ? `#${hash}` : '');
}

/** The absolute URL of a site path (`/docs/components/button`), under the configured base. */
export const absolute = (path = '/') => served(url(path));

/** A BreadcrumbList for structured data, from (name, site path) pairs; the last is the page itself. */
export const breadcrumbs = (trail: readonly (readonly [string, string])[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name,
    item: absolute(path),
  })),
});
