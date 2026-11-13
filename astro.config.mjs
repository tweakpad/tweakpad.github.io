// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { wgslVitePlugin } from 'vgpu/client';
import { satteri } from '@astrojs/markdown-satteri';
import literalCode from './src/lib/vite-literal-code.mjs';
import markdownTables from './src/lib/markdown-tables.mjs';
import modulePreload from './src/lib/module-preload.mjs';
import libraryElements from './src/lib/vite-elements.mjs';

// GitHub Pages serves the site from a sub-path (https://<owner>.github.io/<repo>/) unless a
// custom domain is set. The deploy workflow passes both values from actions/configure-pages.
const site = process.env.SITE_URL ?? 'https://tweakpad.github.io';
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  // modulePreload runs after the build: every page lists the modules its scripts load up front.
  integrations: [mdx(), modulePreload()],
  // The DOM-wide live audit injects 100ms tasks into the moving home canvas.
  // Browser verification uses Chrome DevTools; production has no toolbar.
  devToolbar: { enabled: false },
  // Pages renamed by library releases keep their old address.
  redirects: {
    '/docs/components/list-item': '/docs/components/list',
    // Key hint became Kbd.
    '/docs/components/key-hint': '/docs/components/kbd',
    // Text motion became Text split, in Motion › Text.
    '/docs/components/text-motion': '/docs/motion/text/text-split',
    // The introduction is the Docs landing page.
    '/docs/getting-started/introduction': '/docs',
    // The site's sign-in patterns became the package's Auth pattern, one flow each.
    '/patterns/sign-in': '/patterns/auth#sign-in',
    '/patterns/password-recovery': '/patterns/auth#password-recovery',
    '/patterns/verify-code': '/patterns/auth#verification-code',
    // Kits gave way to DevKit, the tweak panel built on the library.
    '/kits': '/devkit',
  },
  vite: {
    // One copy of the library and Lit for the site and DevKit: a linked devkit checkout brings its
    // own, which would register every element twice.
    resolve: { dedupe: ['@tweakpad/ui', 'lit'] },
    // `.wgsl` imports become prepared vgpu shader sources (the home page's fluid background).
    // `virtual:tp-element/<tag>` registers one library element, so a page loads only its own.
    plugins: [literalCode(), wgslVitePlugin(), libraryElements()],
    build: { chunkSizeWarningLimit: 2000 },
  },
  markdown: {
    // Astro's default processor, with Markdown tables rendered as library Tables (MDX inherits it).
    processor: satteri({ hastPlugins: [markdownTables] }),
    shikiConfig: {
      // Both palettes are emitted as CSS variables; site.css picks one with light-dark().
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
  },
});
