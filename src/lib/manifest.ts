import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * API reference rows read from the published package's Custom Elements Manifest, so component
 * pages always describe the version of @tweakpad/ui the site is built against.
 */
interface ManifestAttribute {
  name: string;
  type?: { text?: string };
  default?: string;
  inheritedFrom?: { name?: string };
}
interface ManifestEvent {
  name?: string;
  inheritedFrom?: { name?: string };
}
interface ManifestMember {
  kind: 'field' | 'method';
  name: string;
  static?: boolean;
  privacy?: 'public' | 'private' | 'protected';
  readonly?: boolean;
  attribute?: string;
  type?: { text?: string };
  description?: string;
  parameters?: { name: string; optional?: boolean }[];
  return?: { type?: { text?: string } };
  inheritedFrom?: { name?: string };
}
interface ManifestDeclaration {
  tagName?: string;
  name?: string;
  attributes?: ManifestAttribute[];
  events?: ManifestEvent[];
  members?: ManifestMember[];
}
interface Manifest {
  modules: { declarations?: ManifestDeclaration[] }[];
}

export interface ElementApi {
  tagName: string;
  className: string;
  attributes: { name: string; type: string; default: string }[];
  events: string[];
  /** The element's own public properties that no attribute reflects, such as object-valued ones. */
  properties: { name: string; type: string; readonly: boolean; description: string }[];
  /** The element's own public methods, one row per name with its overloads merged. */
  methods: { name: string; signature: string; returns: string; description: string }[];
}

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@tweakpad/ui/package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  version: string;
  customElements: string;
};
const manifest = JSON.parse(
  readFileSync(join(dirname(packageJsonPath), packageJson.customElements), 'utf8'),
) as Manifest;

export const uiVersion = packageJson.version;

/** Base-element attributes every component accepts; listed once on the page, not per row. */
const SHARED_BASE = 'TpElement';
const SHARED_KEPT = new Set(['disabled']);

/** Public API the element declares itself; inherited base-class plumbing is left out. */
const ownPublic = (member: ManifestMember) =>
  !member.static &&
  !member.inheritedFrom &&
  (member.privacy ?? 'public') === 'public' &&
  !member.name.startsWith('_') &&
  !member.name.startsWith('#');

function methodsOf(members: ManifestMember[]): ElementApi['methods'] {
  const byName = new Map<string, ManifestMember[]>();
  for (const member of members) {
    if (member.kind !== 'method' || !ownPublic(member)) continue;
    byName.set(member.name, [...(byName.get(member.name) ?? []), member]);
  }
  return [...byName].map(([name, overloads]) => {
    // A parameter is optional when any overload lets it be left out.
    const parameters = new Map<string, boolean>();
    for (const overload of overloads)
      for (const parameter of overload.parameters ?? [])
        parameters.set(parameter.name, (parameters.get(parameter.name) ?? false) || !!parameter.optional);
    const described = overloads.find((overload) => overload.description) ?? overloads[0];
    return {
      name,
      signature: `${name}(${[...parameters].map(([parameter, optional]) => (optional ? `${parameter}?` : parameter)).join(', ')})`,
      returns: described?.return?.type?.text ?? '',
      description: described?.description ?? '',
    };
  });
}

export function elementApi(tagName: string): ElementApi | undefined {
  for (const module of manifest.modules) {
    for (const declaration of module.declarations ?? []) {
      if (declaration.tagName !== tagName) continue;
      const members = declaration.members ?? [];
      return {
        tagName,
        className: declaration.name ?? '',
        attributes: (declaration.attributes ?? [])
          .filter(
            (attribute) =>
              // The analyzer also lists private reactive state (`_copied`), which is not API.
              !attribute.name.startsWith('_') &&
              (attribute.inheritedFrom?.name !== SHARED_BASE || SHARED_KEPT.has(attribute.name)),
          )
          .map((attribute) => ({
            name: attribute.name,
            type: attribute.type?.text ?? '',
            default: attribute.default ?? '',
          })),
        events: [
          ...new Set(
            (declaration.events ?? [])
              .map((event) => event.name ?? '')
              .filter((name) => name && name !== 'tp-diagnostic'),
          ),
        ],
        properties: members
          .filter((member) => member.kind === 'field' && !member.attribute && ownPublic(member))
          .map((member) => ({
            name: member.name,
            type: member.type?.text ?? '',
            readonly: !!member.readonly,
            description: member.description ?? '',
          })),
        methods: methodsOf(members),
      };
    }
  }
  return undefined;
}
