// Component and widget documentation is written once in the @tweakpad/ui package and only
// rendered here (see AGENTS.md). Runs before and after `astro build`:
//
// - before: the site authors no component or widget page, and the installed package ships its
//   pages and documentation index;
// - after (`--dist`): every page of the index was built, and its article uses library components:
//   no native table, pre or button outside a preview's own canvas, template or script.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const require = createRequire(join(root, 'package.json'));
const packageRoot = dirname(require.resolve('@tweakpad/ui/package.json'));

for (const section of ['components', 'motion/text', 'widgets']) {
  const authored = join(root, 'src/content/docs', section);
  if (existsSync(authored))
    problems.push(
      `src/content/docs/${section} must not exist: ${section} pages come from @tweakpad/ui (edit them in the library)`,
    );
  if (!existsSync(join(packageRoot, 'docs', section)))
    problems.push(`the installed @tweakpad/ui has no docs/${section}: update it to a release that ships its pages`);
}
let index;
try {
  index = JSON.parse(readFileSync(require.resolve('@tweakpad/ui/docs.json'), 'utf8'));
} catch {
  problems.push('the installed @tweakpad/ui has no docs.json: update it to a release that ships its documentation index');
}

/** Native elements in a page outside its previews' canvases, templates and scripts. */
function chromeViolations(html) {
  const found = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  let skip = null; // { name, depth } while inside a preview canvas, template or script
  for (const match of html.matchAll(tag)) {
    const [, closing, rawName, attributes] = match;
    const name = rawName.toLowerCase();
    if (skip) {
      if (name === skip.name) skip.depth += closing ? -1 : attributes.trimEnd().endsWith('/') ? 0 : 1;
      if (skip.depth === 0) skip = null;
      continue;
    }
    if (closing) continue;
    if (name === 'template' || name === 'script' || name === 'style' || name === 'svg') {
      skip = { name, depth: 1 };
      continue;
    }
    if (name === 'div' && /class="[^"]*\bpreview__canvas\b/.test(attributes)) {
      skip = { name: 'div', depth: 1 };
      continue;
    }
    if (['table', 'pre', 'button'].includes(name)) found.push(`<${name}>`);
  }
  return found;
}

if (process.argv.includes('--dist') && index) {
  for (const page of index.pages) {
    const file = join(root, 'dist/docs', page.id, 'index.html');
    if (!existsSync(file)) {
      problems.push(`/docs/${page.id} was not built`);
      continue;
    }
    // The page itself: the docs article, not the site header and navigation around it.
    const html = readFileSync(file, 'utf8');
    const start = html.indexOf('<article class="docs-main"');
    const violations = chromeViolations(start === -1 ? html : html.slice(start, html.lastIndexOf('</article>')));
    if (violations.length)
      problems.push(`/docs/${page.id}: native ${[...new Set(violations)].join(', ')} in page chrome; use library components`);
  }
}

for (const problem of problems) console.error(`docs: ${problem}`);
if (problems.length) process.exit(1);
console.log(`docs: ${process.argv.includes('--dist') ? `${index.pages.length} pages built from @tweakpad/ui` : 'sources ok'}`);
