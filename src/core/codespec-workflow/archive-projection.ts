import { stringify as stringifyYaml } from 'yaml';
import MarkdownIt from 'markdown-it';
import { applyCurrentSpecDelta } from './current-archive-merge.js';
import type { CurrentSpecDeltaDocument } from './current-spec-delta.js';
import { parseCurrentSpecification, renderCurrentSpecification } from './current-spec-model.js';

import {
  parseBusinessRegistry,
  parseConfiguration,
  parseModuleApi,
  parseModuleInterface,
  type BusinessRegistry,
  type ConfigurationSnapshot,
  type ModuleApi,
  type ModuleInterface,
} from './current-spec-yaml.js';
import { buildCurrentSpecificationGraph } from './current-spec-graph.js';

/** A new module has no baseline Requirements or engineering paths to modify. */
export function currentSpecDeltaBaseline(content: string | null, delta: CurrentSpecDeltaDocument) {
  return content === null ? {
    title: delta.title, module: delta.module, version: '1' as const, requirements: [], engineeringFiles: [],
  } : parseCurrentSpecification(content);
}

function requirementSections(content: string): Array<{ id: string; start: number; end: number }> {
  const tokens = new MarkdownIt().parse(content, {});
  const headings = tokens.flatMap((token, index) => token.type === 'heading_open' && token.level === 0 && token.map
    ? [{ tag: token.tag, title: tokens[index + 1]!.content, line: token.map[0] }] : []);
  const lines = content.split('\n');
  const offset = (line: number) => lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
  return headings.flatMap((heading, index) => {
    const id = heading.tag === 'h2' && heading.title.match(/^(MOD-\d{3}-REQ-\d{3})：/u)?.[1];
    if (!id) return [];
    const end = headings.slice(index + 1).find((next) => next.tag === 'h2' || ['当前模块工程文件', '最近验证摘要'].includes(next.title));
    return [{ id, start: offset(heading.line), end: end ? offset(end.line) : content.length }];
  });
}

/** Render complete Current, retaining unlisted Requirement sections verbatim. */
export function projectCurrentSpecDelta(content: string | null, delta: CurrentSpecDeltaDocument): string {
  const { specification } = applyCurrentSpecDelta(currentSpecDeltaBaseline(content, delta), delta);
  let rendered = renderCurrentSpecification(specification);
  if (content === null) return rendered;
  const changed = new Set(delta.requirements.map((entry) => entry.id));
  const original = new Map(requirementSections(content).map((section) => [section.id, content.slice(section.start, section.end)]));
  for (const section of requirementSections(rendered).reverse()) {
    if (!changed.has(section.id) && original.has(section.id)) {
      rendered = rendered.slice(0, section.start) + original.get(section.id)! + rendered.slice(section.end);
    }
  }
  return rendered;
}

export interface ArchiveModuleProjection {
  spec: string;
  interface: string;
  api: string;
}

export interface ArchiveProjection {
  modules: Map<string, ArchiveModuleProjection>;
  business: string;
  configuration: string;
}

export interface ArchiveProjectionInput {
  specs: Map<string, string>;
  business: BusinessRegistry;
  interfaces: Map<string, ModuleInterface>;
  configuration: ConfigurationSnapshot;
  newModuleIds?: ReadonlySet<string>;
}

function emptyApi(module: string): ModuleApi {
  return parseModuleApi({ version: 1, module, routes: [] });
}

/** Build the complete canonical Current Specification projection in memory. */
export function buildArchiveProjection(input: ArchiveProjectionInput): ArchiveProjection {
  const interfaces = new Map(
    [...input.interfaces.entries()]
      .map(([module, document]) => [module, parseModuleInterface(document)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  for (const module of input.business.modules) {
    if (!interfaces.has(module.id) && input.newModuleIds?.has(module.id)) {
      interfaces.set(module.id, parseModuleInterface({ version: 1, module: module.id, relations: [] }));
    }
  }
  const graph = buildCurrentSpecificationGraph({
    modules: input.business.modules.map(({ id, name, status }) => ({ id, name, status })),
    interfaces: [...interfaces.values()],
  });
  const modules = new Map<string, ArchiveModuleProjection>();

  for (const module of graph.business.modules) {
    const spec = input.specs.get(module.id);
    if (spec === undefined) continue;
    const document = interfaces.get(module.id);
    if (!document) throw new Error(`Missing interface.yaml for module ${module.id}`);
    const api = graph.apis.get(module.id) ?? emptyApi(module.id);
    modules.set(module.id, {
      spec,
      interface: stringifyYaml(document),
      api: stringifyYaml(api),
    });
  }

  return {
    modules,
    business: stringifyYaml(parseBusinessRegistry(graph.business)),
    configuration: stringifyYaml(parseConfiguration(input.configuration)),
  };
}
