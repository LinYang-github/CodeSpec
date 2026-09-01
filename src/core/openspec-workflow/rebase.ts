import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { captureBaseline, type Baseline } from './baseline.js';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import { parseDeltaSpec } from './delta-parser.js';
import type { ChangeMetadata, RequirementDelta } from './types.js';

export interface RebaseDecision { strategy: 'semantic-rebase'; route: 'DESIGN'; reason: string; current_specs: string[]; decisions: Array<{ requirement_id: string; action: string; previous: string }> }
export interface RebaseResult { change: ChangeMetadata['change']; baseline: Baseline; decision: RebaseDecision }

function requirementBlock(spec: string, id: string): string | undefined {
  const headings = [...spec.matchAll(/^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+.*)?$/gmu)];
  const heading = headings.find((item) => item[1] === id); if (!heading || heading.index === undefined) return undefined;
  const next = headings.find((item) => (item.index ?? 0) > heading.index!);
  return spec.slice(heading.index, next?.index ?? spec.length).trim();
}
function withoutHeading(value: string): string { return value.replace(/^###[ \t]+MOD-\d{3}-REQ-\d{3}(?:[ \t]+[^\n]*)?\n?/u, '').trim(); }
function renderDelta(entries: RequirementDelta[], current: Map<string, string>): string {
  const sections = new Map<RequirementDelta['action'], RequirementDelta[]>([['ADDED', []], ['MODIFIED', []], ['REMOVED', []]]);
  for (const original of entries) {
    const entry = structuredClone(original);
    const latest = current.get(entry.module); const block = latest ? requirementBlock(latest, entry.id) : undefined;
    if ((entry.action === 'MODIFIED' || entry.action === 'REMOVED') && block) entry.previous = withoutHeading(block);
    sections.get(entry.action)!.push(entry);
  }
  return [...sections.entries()].filter(([, items]) => items.length).map(([action, items]) => [
    `## ${action}`,
    ...items.map((entry) => {
      const title = entry.title ?? entry.id;
      const parts = [`### ${entry.id} ${title}`];
      if (entry.previous) parts.push('**Previous**', entry.previous);
      if (entry.next) parts.push('**New**', withoutHeading(entry.next));
      if (entry.reason) parts.push('**Reason**', entry.reason);
      return parts.filter(Boolean).join('\n');
    }),
  ].join('\n')).join('\n\n').trim() + '\n';
}

async function loadCurrentSpecs(workspace: WorkspaceContext, metadata: ChangeMetadata, supplied: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const configured = new Set(metadata.modules.confirmed.map((item) => item.module));
  const suppliedContents: string[] = [];
  for (const item of supplied) {
    if (/^###\s+MOD-\d{3}-REQ-\d{3}/mu.test(item)) suppliedContents.push(item);
    else {
      const resolved = path.resolve(item);
      const relative = path.relative(workspace.openspecDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Current specification path must be under openspec: ${item}`);
      suppliedContents.push(await fs.readFile(resolved, 'utf8'));
    }
  }
  for (const content of suppliedContents) {
    const module = [...content.matchAll(/^###\s+(MOD-\d{3})-REQ-/gmu)][0]?.[1];
    if (module) result.set(module, content);
  }
  for (const module of configured) if (!result.has(module)) {
    const file = path.join(workspace.paths.currentSpecs, module, 'spec.md');
    try { result.set(module, await fs.readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; result.set(module, ''); }
  }
  return result;
}

export async function rebaseChange(workspace: WorkspaceContext, changeId: string, currentSpecs: string[] = []): Promise<RebaseResult> {
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const change = structuredClone(artifacts.metadata);
  if (!change.baseline.stale) throw new Error(`Change ${changeId} is not stale`);
  const current = await loadCurrentSpecs(workspace, change, currentSpecs);
  let entries: RequirementDelta[];
  try { entries = parseDeltaSpec(artifacts.spec).entries; }
  catch (error) { throw new Error(`Cannot semantically rebase malformed delta spec: ${error instanceof Error ? error.message : String(error)}`); }
  const decisions = entries.map((entry) => ({ requirement_id: entry.id, action: entry.action, previous: current.get(entry.module) ? requirementBlock(current.get(entry.module)!, entry.id) ?? '' : '' }));
  const unresolved = decisions.filter((item) => (item.action !== 'ADDED' && !item.previous));
  if (unresolved.length) throw new Error(`Unresolved Rebase decisions for Requirements: ${unresolved.map((item) => item.requirement_id).join(', ')}`);
  const nextSpec = renderDelta(entries, current);
  const decision: RebaseDecision = { strategy: 'semantic-rebase', route: 'DESIGN', reason: 'Re-evaluated each Requirement against the configured Current Specification; authored New/Reason content was preserved.', current_specs: [...current.values()], decisions };
  change.change.revision += 1; change.change.status = 'DESIGN'; change.change.updated_at = new Date().toISOString();
  const baseline = await captureBaseline(workspace, change, Object.fromEntries(current));
  change.baseline = baseline;
  const metadataPath = path.join(workspace.openspecDir, change.artifacts.metadata); const specPath = path.join(workspace.openspecDir, change.artifacts.spec); const designPath = path.join(workspace.openspecDir, change.artifacts.design);
  const token = `.rebase-${process.pid}-${Date.now()}`; const metadataTmp = `${metadataPath}.${token}.tmp`; const specTmp = `${specPath}.${token}.tmp`; const designTmp = `${designPath}.${token}.tmp`;
  const original = { metadata: await fs.readFile(metadataPath, 'utf8'), spec: await fs.readFile(specPath, 'utf8'), design: await fs.readFile(designPath, 'utf8') };
  try {
    await fs.writeFile(metadataTmp, stringifyYaml(change)); await fs.writeFile(specTmp, nextSpec); await fs.writeFile(designTmp, `${original.design}\n\n## Rebase decision (revision ${change.change.revision})\n\n${stringifyYaml(decision)}`);
    await fs.rename(metadataTmp, metadataPath); await fs.rename(specTmp, specPath); await fs.rename(designTmp, designPath);
  } catch (error) {
    await fs.writeFile(metadataPath, original.metadata).catch(() => undefined); await fs.writeFile(specPath, original.spec).catch(() => undefined); await fs.writeFile(designPath, original.design).catch(() => undefined);
    await fs.rm(metadataTmp, { force: true }).catch(() => undefined); await fs.rm(specTmp, { force: true }).catch(() => undefined); await fs.rm(designTmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { change: change.change, baseline, decision };
}
