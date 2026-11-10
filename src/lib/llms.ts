import { componentsOf, docPath, docsByGroup, type DocEntry, type PatternEntry } from './content';
import { elementApi, tokenFamilies, uiVersion } from './manifest';
import { REPOSITORY, SITE_NAME, SITE_SUMMARY, absolute } from './seo';

/**
 * The documentation as plain Markdown for language models (llmstxt.org): `/llms.txt` indexes the
 * pages, `/llms-full.txt` holds them all. Pages come from the same collections as the site, so a
 * new library page appears here too. MDX is flattened to Markdown: demos and code samples become
 * fenced code, keyboard shortcuts become code spans and links become absolute.
 */

/** The opening both files share: what the library is and how to start. */
export function preamble(): string {
  return `# ${SITE_NAME}

> ${SITE_SUMMARY}

${SITE_NAME} (\`@tweakpad/ui\`, version ${uiVersion}) is a library of accessible web components built with Lit. Every component is a custom element (\`tp-*\`), so the same markup works in plain HTML and in any framework that renders the DOM. Styling flows through inherited \`--tp-*\` design tokens: a theme is a set of custom properties.

Install and register every element once, with the stylesheet:

\`\`\`sh
npm install @tweakpad/ui
\`\`\`

\`\`\`ts
import '@tweakpad/ui/register';
import '@tweakpad/ui/styles.css';
\`\`\`

React components are exported from \`@tweakpad/ui/react\` (widgets from \`@tweakpad/ui/widgets/react\`), one per element, named without the \`tp-\` prefix. Source: ${REPOSITORY}
`;
}

/** The docs in site order: Getting started, Components, Motion (by subgroup), Widgets. */
export async function docSections() {
  return (await docsByGroup()).map((group) => ({
    label: group.label,
    entries: group.subgroups.length ? group.subgroups.flatMap((subgroup) => subgroup.entries) : group.entries,
  }));
}

export const docUrl = (entry: DocEntry) => absolute(docPath(entry));
export const patternUrl = (pattern: PatternEntry) => absolute(`/patterns/${pattern.id}`);

/** One page of `/llms-full.txt`: its title, address, description, body and API reference. */
export async function docMarkdown(entry: DocEntry): Promise<string> {
  const url = docUrl(entry);
  const parts = [`# ${entry.data.title}`, `URL: ${url}`, `> ${entry.data.description}`, mdxToMarkdown(entry.body ?? '', url)];
  if ('tokens' in entry.data && entry.data.tokens) parts.push(tokensMarkdown());
  if ('tag' in entry.data) {
    const api = [entry.data.tag, ...entry.data.parts].map((tag) => apiMarkdown(tag)).filter(Boolean);
    if (api.length) parts.push(`## API Reference\n\n${api.join('\n\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export async function patternMarkdown(pattern: PatternEntry): Promise<string> {
  const url = patternUrl(pattern);
  const components = (await componentsOf(pattern)).map((doc) => `[${doc.data.title}](${docUrl(doc)})`);
  return [
    `# ${pattern.data.title} (pattern)`,
    `URL: ${url}`,
    `> ${pattern.data.description}`,
    components.length ? `Built from: ${components.join(', ')}.` : '',
    fence('html', pattern.data.example.trimEnd()),
    mdxToMarkdown(pattern.body ?? '', url),
  ]
    .filter(Boolean)
    .join('\n\n');
}

// --- MDX to Markdown ---------------------------------------------------------------------------

const fence = (language: string, code: string) => {
  // A fence longer than any backtick run inside the code.
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${language}\n${code}\n${ticks}`;
};

/** Reads one JSX element's attributes from `source` at `start` (just past its name). */
function readAttributes(source: string, start: number) {
  const attributes: Record<string, string> = {};
  let i = start;
  const skipSpace = () => {
    while (i < source.length && /\s/.test(source[i]!)) i++;
  };
  while (i < source.length) {
    skipSpace();
    if (source.startsWith('/>', i)) return { attributes, end: i + 2, closed: true };
    if (source[i] === '>') return { attributes, end: i + 1, closed: false };
    const name = /^[\w:-]+/.exec(source.slice(i))?.[0];
    if (!name) return undefined;
    i += name.length;
    skipSpace();
    if (source[i] !== '=') {
      attributes[name] = 'true';
      continue;
    }
    i++;
    skipSpace();
    const quote = source[i];
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, i + 1);
      attributes[name] = source.slice(i + 1, close);
      i = close + 1;
    } else if (quote === '{') {
      // A template literal (`{`...`}`) is read up to its closing backtick; anything else by braces.
      let j = i + 1;
      while (/\s/.test(source[j]!)) j++;
      if (source[j] === '`') {
        let k = j + 1;
        while (k < source.length && source[k] !== '`') k += source[k] === '\\' ? 2 : 1;
        attributes[name] = source.slice(j + 1, k).replace(/\\([`$\\])/g, '$1');
        i = source.indexOf('}', k) + 1;
      } else {
        let depth = 0;
        let k = i;
        for (; k < source.length; k++) {
          if (source[k] === '{') depth++;
          else if (source[k] === '}' && --depth === 0) break;
        }
        attributes[name] = source.slice(i + 1, k).trim();
        i = k + 1;
      }
    } else return undefined;
  }
  return undefined;
}

/** The site's MDX components, as Markdown. */
const COMPONENTS: Record<string, (attributes: Record<string, string>) => string> = {
  Preview: ({ title, code, script }) =>
    [title && `**Example: ${title}**`, code && fence('html', code.trim()), script && fence('js', script.trim())]
      .filter(Boolean)
      .join('\n\n'),
  Code: ({ language = '', code = '', filename }) =>
    [filename && `\`${filename}\`:`, fence(language, code.trim())].filter(Boolean).join('\n\n'),
  Keys: ({ keys = '' }) => `\`${keys}\``,
};
const COMPONENT = new RegExp(`<(${Object.keys(COMPONENTS).join('|')})\\b`, 'g');

/** Links relative to the page become absolute; anchors point into the page. */
const absoluteLinks = (text: string, page: string) =>
  text.replace(/\]\((?!https?:|mailto:)([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, href: string, title: string) => `](${new URL(href, page).href}${title})`);

/** The MDX body of a page as Markdown, for a page served at `page`. */
export function mdxToMarkdown(body: string, page: string): string {
  // Fenced code is kept verbatim; only the prose between fences is converted.
  return body
    .split(/(^```[\s\S]*?^```[ \t]*$)/m)
    .map((chunk, index) => (index % 2 ? chunk : convertProse(chunk, page)))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function convertProse(text: string, page: string): string {
  const prose = text.replace(/^import\s.+?from\s+['"].+?['"];?[ \t]*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  let out = '';
  let last = 0;
  for (const match of prose.matchAll(COMPONENT)) {
    if (match.index! < last) continue;
    const element = readAttributes(prose, match.index! + match[0].length);
    if (!element) continue;
    out += absoluteLinks(prose.slice(last, match.index), page) + COMPONENTS[match[1]!]!(element.attributes);
    last = element.end;
    // Content between an element's tags is dropped along with its closing tag.
    if (!element.closed) {
      const close = prose.indexOf(`</${match[1]}>`, last);
      if (close >= 0) last = close + match[1]!.length + 3;
    }
  }
  return out + absoluteLinks(prose.slice(last), page);
}

// --- API reference and tokens ------------------------------------------------------------------

const cell = (value: unknown) => String(value ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
const code = (value: unknown) => {
  const text = cell(value);
  if (!text) return '';
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
};
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

/** An element's API as Markdown tables, in the order and columns of the page (ApiTable.astro). */
export function apiMarkdown(tag: string): string {
  const api = elementApi(tag);
  if (!api) return '';
  const groups: [string, string[], unknown[], (row: any) => string[]][] = [
    ['Attributes', ['Attribute', 'Property', 'Type', 'Default', 'Description'], api.attributes, (row) => [code(row.name), code(row.property), code(row.type), code(row.default), cell(row.description)]],
    ['Properties', ['Property', 'Type', 'Default', 'Description'], api.properties, (row) => [code(row.name), code(row.type), code(row.default), cell(row.description)]],
    ['Events', ['Event', 'Type', 'Description'], api.events, (row) => [code(row.name), code(row.type), cell(row.description)]],
    ['Methods', ['Method', 'Returns', 'Description'], api.methods, (row) => [code(row.signature), code(row.returns), cell(row.description)]],
    ['Slots', ['Slot', 'Description'], api.slots, (row) => [code(row.name || 'default'), cell(row.description)]],
    ['CSS parts', ['Part', 'Description'], api.cssParts, (row) => [code(`::part(${row.name})`), cell(row.description)]],
    ['CSS custom properties', ['Property', 'Default', 'Description'], api.cssProperties, (row) => [code(row.name), code(row.default), cell(row.description)]],
  ];
  return groups
    .filter(([, , rows]) => rows.length > 0)
    .map(([name, head, rows, columns]) => `### \`<${tag}>\` ${name.toLowerCase()}\n\n${table(head, rows.map(columns))}`)
    .join('\n\n');
}

/** The design token catalog: each family's roles and what they are for. */
function tokensMarkdown(): string {
  return tokenFamilies
    .map((family) => `## ${family.title}\n\n${family.description}\n\n${table(['Token', 'Description'], family.roles.map((entry) => [code(`--tp-${entry.role}`), cell(entry.description)]))}`)
    .join('\n\n');
}
