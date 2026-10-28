# tweakpad.github.io agent instructions

## Component and widget documentation is not authored here

Every component and widget page under `/docs/components/` and `/docs/widgets/` comes from the
`@tweakpad/ui` package. It is written once in the library repository (`tweakpad/ui`,
`docs/components/<slug>.mdx` and `docs/widgets/<slug>.mdx`). This site renders the installed
version.

- **Never** add or edit `src/content/docs/components/*.mdx` or `src/content/docs/widgets/*.mdx`,
  and never author an API table or a Related list by hand. `npm run build` fails if those folders
  exist.
- To change a page's text or demos, change it in the library under its **tweakpad-docs** skill
  (`.agents/skills/tweakpad-docs/SKILL.md` in the library repo). Then release the library and bump
  `@tweakpad/ui` here. To preview unreleased pages, `npm link` the library checkout.
- This site owns only the **rendering**, with library components for every part:
  - `Preview.astro`, `Code.astro` and `Keys.astro` render the page's `<Preview>`, `<Code>` and
    `<Keys>` elements.
  - `ApiTable.astro` renders API Reference as `tp-table`s: Attributes, Properties, Events, then
    Methods, Slots, CSS parts and CSS custom properties.
  - The Related section (website only) lists the components and widgets that render the element,
    then the patterns built from it: four cards at most, the rest in a `tp-collapsible` labelled
    "Show more" (`Related.astro`). When nothing uses the element, the page has no Related
    section at all.

  Never use native `<table>`, `<pre>` or `<button>` in page chrome. Never share rendering code
  with the library's Storybook.
- Getting-started guides (`src/content/docs/getting-started/`), patterns and kits are authored here.

## Verification

Use the `chrome-devtools` MCP server for every browser check. Read changed pages rendered: the
header, main demo, Usage, API Reference and Related appear in order, and the previews run.
