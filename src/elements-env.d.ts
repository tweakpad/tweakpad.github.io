/** Every library element tag, mapped to a loader that defines it (`src/lib/vite-elements.mjs`). */
declare module 'virtual:tp-elements' {
  const loaders: Record<string, () => Promise<unknown>>;
  export default loaders;
  /** Every tag, in the order `@tweakpad/ui/register` defines elements in (widgets last). */
  export const order: string[];
}

interface Window {
  /** Resolves to a function that defines the document's library elements (`src/lib/elements.ts`). */
  __tpElements?: { ready: Promise<() => Promise<void>>; resolve: (define: () => Promise<void>) => void };
}

/** Re-exports of the names preview scripts import from a barrel entry (`src/lib/vite-elements.mjs`). */
declare module 'virtual:tp-preview/*' {
  const names: Record<string, unknown>;
  export = names;
}
