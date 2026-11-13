// @ts-check
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

/** Packages resolve from the project root, where builds run (npm scripts and CI). */
const require = createRequire(join(process.cwd(), 'package.json'));

/**
 * Lists every module a page's scripts load before they run, as `<link rel="modulepreload">` in its
 * head. Astro emits one `<script type="module" src>` per entry, and the browser only finds a
 * chunk's imports once that chunk has downloaded: `@tweakpad/ui/register` sits three requests
 * deep, so the library could not start until the third round trip finished. With every static
 * import named up front, all of them download at once.
 *
 * The preloads ask for low priority: the stylesheets, fonts and the page's own entry scripts go
 * first, so first paint never waits on library code it does not need.
 *
 * The library elements in the page's markup (`tp-*`, templates included) are preloaded too, with
 * the modules they import: `src/lib/elements.ts` loads each one with `import()` once the page has
 * parsed, and its chunk is named after the tag (`vite-elements.mjs`). Other dynamic imports are left
 * out: those load on demand, such as the home page's fluid renderer, only where WebGPU exists.
 *
 * @returns {import('astro').AstroIntegration}
 */
export default function modulePreload() {
  let base = '/';
  return {
    name: 'site:module-preload',
    hooks: {
      'astro:config:done': ({ config }) => {
        base = config.base.endsWith('/') ? config.base : `${config.base}/`;
      },
      'astro:build:done': async ({ dir, logger }) => {
        await init();
        const root = fileURLToPath(dir);
        /** Every element the library declares (its custom-elements.json). */
        const manifest = JSON.parse(await readFile(join(dirname(require.resolve('@tweakpad/ui/package.json')), 'dist', 'custom-elements.json'), 'utf8'));
        const libraryTags = new Set(manifest.modules.flatMap((/** @type {any} */ module) => (module.declarations ?? []).map((/** @type {any} */ declaration) => declaration.tagName).filter(Boolean)));
        /** @type {Map<string, string[]>} tags no library element has, with the pages using them */
        const unknown = new Map();
        /** Each library element's chunk, by tag: `<tag>.<hash>.js`, one per tag. */
        const elementChunks = new Map();
        for (const name of await readdir(join(root, '_astro'))) {
          const tag = /^(tp-[a-z0-9-]+)\.[\w-]+\.js$/.exec(name)?.[1];
          if (!tag) continue;
          if (elementChunks.has(tag)) throw new Error(`Two chunks are named after <${tag}>: ${elementChunks.get(tag)} and ${name}`);
          elementChunks.set(tag, `${base}_astro/${name}`);
        }
        /** Static imports of each chunk, by its served path. */
        const imports = new Map();
        /** A served path (`/<base>/_astro/x.js`) as a file in the build output (`_astro/x.js`). */
        const servedFile = (/** @type {string} */ path) => path.slice(path.indexOf('/_astro/') + 1);
        /** @param {string} path a served path, such as `/_astro/x.js` */
        const staticImports = async (path) => {
          if (imports.has(path)) return imports.get(path);
          /** @type {string[]} */
          const found = [];
          imports.set(path, found);
          const source = await readFile(join(root, servedFile(path)), 'utf8').catch(() => undefined);
          if (source === undefined) return found;
          for (const entry of parse(source)[0]) {
            if (entry.type === 'dynamic' || !entry.specifier?.startsWith('.')) continue;
            found.push(new URL(entry.specifier, `http://site${path}`).pathname);
          }
          return found;
        };

        let pages = 0;
        for (const file of await htmlFiles(root)) {
          const html = await readFile(file, 'utf8');
          const entries = [...html.matchAll(/<script type="module" src="([^"]*\/_astro\/[^"]+\.js)"/g)].map((m) => m[1]);
          const preload = new Set();
          for (const tag of new Set([...html.matchAll(/<(tp-[a-z0-9-]+)[\s>/]/g)].map((m) => m[1]))) {
            const chunk = elementChunks.get(tag);
            if (chunk) preload.add(chunk);
            // A library element the page cannot define would stay inert: the site failed it.
            else if (libraryTags.has(tag)) throw new Error(`${relative(root, file)} uses <${tag}>, which has no element chunk (vite-elements.mjs)`);
            // A tag the library does not have is a mistake in the page's source, not the site's.
            else unknown.set(tag, [...(unknown.get(tag) ?? []), relative(root, file)]);
          }
          const queue = [...entries, ...preload];
          while (queue.length > 0) {
            for (const dependency of await staticImports(/** @type {string} */ (queue.shift()))) {
              if (preload.has(dependency) || entries.includes(dependency)) continue;
              preload.add(dependency);
              queue.push(dependency);
            }
          }
          if (preload.size === 0) continue;
          const links = [...preload].map((href) => `<link rel="modulepreload" href="${href}" fetchpriority="low">`).join('');
          await writeFile(file, html.replace('</head>', `${links}</head>`));
          pages++;
        }
        for (const [tag, files] of unknown) logger.warn(`<${tag}> is not a @tweakpad/ui element, used in ${files.join(', ')}`);
        logger.info(`module preloads written to ${pages} pages`);
      },
    },
  };
}

/** @param {string} directory */
async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.html')).map((entry) => join(entry.parentPath, entry.name));
}
