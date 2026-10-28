/**
 * Renders every Markdown table as a library Table, built from its parts (`tp-table-header`,
 * `tp-table-row`, `tp-table-head`, `tp-table-cell`…). The first cell of each body row names the row,
 * so it becomes a row header, and the Table is a region named after the heading it sits under, so
 * keyboard and screen reader users can tell the tables apart.
 *
 * A Sätteri hast plugin: the visitor sees headings and tables in document order, and the factory
 * gives each document its own last heading. Later tables under the same heading are numbered, so
 * every region has its own name. Cell content is passed through untouched.
 */
const PARTS = {
  table: 'tp-table',
  caption: 'tp-table-caption',
  thead: 'tp-table-header',
  tbody: 'tp-table-body',
  tfoot: 'tp-table-footer',
  tr: 'tp-table-row',
  th: 'tp-table-head',
  td: 'tp-table-cell',
};
const SECTIONS = new Set(['thead', 'tbody', 'tfoot']);
/** Elements whose whitespace between children is only source formatting. */
const STRUCTURE = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);

const toParts = (node, section) => {
  if (node.type !== 'element' || !(node.tagName in PARTS)) return node;
  const within = SECTIONS.has(node.tagName) ? node.tagName : section;
  const children = [...node.children]
    .filter((child) => !(STRUCTURE.has(node.tagName) && child.type === 'text' && !child.value.trim()))
    .map((child) => toParts(child, within));
  if (node.tagName === 'tr' && within !== 'thead' && children[0]?.tagName === 'tp-table-cell') {
    children[0] = { ...children[0], tagName: 'tp-table-head', properties: { ...children[0].properties, scope: 'row' } };
  }
  // Column alignment from the Markdown (`:--:`) becomes the text-align a part passes to its cell.
  const { align, ...properties } = node.properties ?? {};
  if (align) properties.style = `text-align:${align}`;
  return { type: 'element', tagName: PARTS[node.tagName], properties, children };
};

export default function markdownTables() {
  let heading = '';
  let count = 0;
  return {
    name: 'tweakpad:markdown-tables',
    element: {
      filter: ['h2', 'h3', 'h4', 'h5', 'h6', 'table'],
      visit(node, ctx) {
        if (node.tagName !== 'table') {
          heading = ctx.textContent(node).trim();
          count = 0;
          return;
        }
        count += 1;
        const name = heading || 'Table';
        const table = toParts(node, '');
        table.properties = { className: ['prose-table'], label: count > 1 ? `${name}, table ${count}` : name };
        ctx.replaceNode(node, table);
      },
    },
  };
}
