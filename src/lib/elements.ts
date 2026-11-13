import loaders, { order } from 'virtual:tp-elements';

/** Each tag's place in the order `@tweakpad/ui/register` defines elements in. */
const rank = new Map(order.map((tag, index) => [tag, index]));

/**
 * Defines the library elements a page uses, and only those (see `vite-elements.mjs`).
 *
 * Every `tp-*` element in the document is defined, including those in `<template>` contents
 * (preview sources, the home intro's border), which scripts clone into the page later. Elements
 * added afterwards (the client router's next page, a preview script's own markup) are defined as
 * they arrive. An element's definition also defines the library elements it renders.
 */
/** Each tag's module, once requested: its default export defines the element. */
const modules = new Map<string, Promise<{ default: () => void }>>();

/** The undefined library tags under `root`, including inside templates. */
function undefinedTags(root: ParentNode, into = new Set<string>()): Set<string> {
  if (root instanceof Element && root.localName.startsWith('tp-') && !customElements.get(root.localName)) {
    into.add(root.localName);
  }
  for (const element of root.querySelectorAll(':not(:defined)')) {
    if (element.localName.startsWith('tp-')) into.add(element.localName);
  }
  if (root instanceof HTMLTemplateElement) undefinedTags(root.content, into);
  for (const template of root.querySelectorAll('template')) undefinedTags(template.content, into);
  return into;
}

/**
 * Loads these tags' modules, then defines them all in one task; resolves once they are defined.
 *
 * Elements expect the elements they work with to upgrade alongside them: a Toggle group updates
 * its Toggles when it first renders. Defining a batch together, before any element's first
 * (microtask) update runs, in register.js's order, keeps what `@tweakpad/ui/register` gave.
 */
export async function define(tags: Iterable<string>): Promise<void> {
  const batch: Promise<{ default: () => void }>[] = [];
  for (const tag of [...tags].sort((a, b) => (rank.get(a) ?? rank.size) - (rank.get(b) ?? rank.size))) {
    if (customElements.get(tag)) continue;
    let module = modules.get(tag);
    if (!module) {
      const loader = loaders[tag];
      if (!loader) {
        console.warn(`<${tag}> is not an element @tweakpad/ui exports.`);
        continue;
      }
      module = loader() as Promise<{ default: () => void }>;
      modules.set(tag, module);
    }
    batch.push(module);
  }
  for (const module of await Promise.all(batch)) module.default();
}

/** Defines every library element in the document now; resolves once they are defined. */
export function defineDocument(): Promise<void> {
  return define(undefinedTags(document));
}

export function start(): void {
  void defineDocument();
  new MutationObserver((records) => {
    const tags = new Set<string>();
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) undefinedTags(node, tags);
    }
    if (tags.size) void define(tags);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Preview scripts wait for the page's elements before they run (`Preview.astro`).
  window.__tpElements?.resolve(defineDocument);
}
