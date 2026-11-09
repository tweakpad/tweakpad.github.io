import { readFile } from 'node:fs/promises';

/** Development-only rectangle inspector; never emitted into the public site. */
export default function introDebugRoute() {
  return {
    name: 'intro-grid-debug',
    configureServer(server) {
      server.middlewares.use('/__debug/intro-grid', async (_req, res, next) => {
        try {
          const source = await readFile(new URL('../debug/intro-grid.html', import.meta.url), 'utf8');
          const html = await server.transformIndexHtml('/__debug/intro-grid', source);
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        } catch (error) { next(error); }
      });
    },
  };
}
