// @ts-check
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

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
 * Dynamic imports (`import()`) are left out: those load on demand, such as the home page's fluid
 * renderer, which loads only where WebGPU exists.
 *
 * @returns {import('astro').AstroIntegration}
 */
export default function modulePreload() {
  return {
    name: 'site:module-preload',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        await init;
        const root = fileURLToPath(dir);
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
          if (entries.length === 0) continue;
          const preload = new Set();
          const queue = [...entries];
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
