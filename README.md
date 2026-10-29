# Tweakpad site

The documentation and showcase site for [Tweakpad UI](https://github.com/tweakpad/ui), built with [Astro](https://astro.build) and deployed to GitHub Pages.

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # astro check + static build into dist/
npm run preview  # serve dist/
```

Node 24 (see `.nvmrc`).

## Structure

| Path | Contents |
| --- | --- |
| `src/content/docs/` | Getting-started guides. The introduction is the Docs landing page, shown under the section banner at `/docs`. Component and widget pages come from the installed `@tweakpad/ui` (the `library` collection); see below. |
| `src/components/SideNav.astro` | A section's page list on the library's Tree view: sections collapse, pages are links, the current page is selected. The docs layout uses it; Patterns can take it once real patterns arrive. |
| `src/content/patterns/` | Recipes composed from several components. `example` holds the composition, shown live on the pattern page; `featured` puts it on the home page canvas; `components` lists the component or widget pages it uses, which link back under "Related". |
| `src/content/kits/` | Plans for kits for niche products (audio editor, trading terminal, graph editor). The Kits page shows a coming-soon message for now. |
| `src/components/PatternCanvas.astro` | The home page: an endless, pannable grid of the featured pattern compositions. |
| `public/fonts/` | Fivo Sans (SIL Open Font License, see `OFL.txt`), self-hosted for body text. Display type is Anton from Google Fonts. |
| `src/components/Preview.astro` | Live example with a Default/Compact density selector and a Code toggle that shows the source in `tp-code-block`. |
| `src/styles/site.css` | Site chrome and the black-and-white tuning of the library's tokens. |
| `src/layouts/BaseLayout.astro` | The document shell. Astro's client router swaps pages in place, keeping the header and the docs sidebar (`transition:persist`); scripts that bind to page content run from the `astro:page-load` event. |

The site uses the published `@tweakpad/ui` package for every live demo and for its own chrome (theme switcher, search palette, buttons), so the header theme switcher re-themes the demos too.

## Component and widget pages

Component and widget pages are not written here. Each one is written once in the library repository, as `docs/components/<slug>.mdx`, `docs/motion/<group>/<slug>.mdx` or `docs/widgets/<slug>.mdx`, following its `tweakpad-docs` skill, and ships in `@tweakpad/ui`. The `library` content collection reads those files from the installed package.

The site renders each page with its own components:

- `Preview.astro`, `Code.astro` and `Keys.astro` for the page's elements.
- API Reference from the package's Custom Elements Manifest (`ApiTable.astro`).
- Related, from the package's `docs.json` and pattern frontmatter (`Related.astro`).

`npm run build` fails if `src/content/docs/components`, `src/content/docs/motion` or `src/content/docs/widgets` exists. It also fails if the built pages use a native table, pre or button outside a preview.

To see unreleased library pages, link the library checkout:

```sh
(cd ../tweakpad/library && npm run build)
npm link ../tweakpad/library
npm run dev
```

A preview's `script` runs after its markup as a module. It may import from:

- `@tweakpad/ui` and its subpath entries;
- `lit`;
- the Tiptap and Lexical modules of the text editor demos.

It imports them like app code does, with named or namespace imports. The page swaps those imports for the site's bundled copies, and the copyable code keeps them as written. A new specifier goes in both `SPECIFIER` and `previewModules` in `Preview.astro`.

## Deploy

Pushes to `main` build and publish with `.github/workflows/deploy.yml`. The workflow reads the Pages origin and base path from `actions/configure-pages`, so links work both at `https://tweakpad.github.io/site/` and on a custom domain.
