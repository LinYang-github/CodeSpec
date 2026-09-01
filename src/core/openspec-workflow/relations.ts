import { loadChangeArtifacts, type WorkspaceContext } from './loaders.js';
import type { ChangeMetadata } from './types.js';

export async function validateRelations(workspace: WorkspaceContext, metadata: ChangeMetadata): Promise<void> {
  const refs = [...metadata.relations.depends_on, ...metadata.relations.related_to, ...metadata.relations.conflicts_with, ...metadata.relations.supersedes];
  const loaded = new Map<string, ChangeMetadata>([[metadata.change.id, metadata]]);
  for (const id of refs) {
    if (id === metadata.change.id) throw new Error(`Invalid relation ID: ${id}`);
    try { loaded.set(id, (await loadChangeArtifacts(workspace.paths, id)).metadata); }
    catch { throw new Error(`Invalid relation ID: ${id}`); }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Relation cycle detected');
    if (visited.has(id)) return;
    visiting.add(id);
    const entry = loaded.get(id);
    for (const dep of entry?.relations.depends_on ?? []) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  visit(metadata.change.id);
  for (const dep of metadata.relations.depends_on) {
    const entry = loaded.get(dep);
    if (entry?.change.status !== 'ARCHIVED') throw new Error(`Dependency ${dep} must be ARCHIVED before this Change`);
  }
}
