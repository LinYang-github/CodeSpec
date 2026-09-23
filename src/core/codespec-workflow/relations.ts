import type { WorkspaceContext } from './loaders.js';
import { loadCurrentSpecGraph } from './current-spec-graph-loader.js';
import { validateCurrentSpecGraphTraceabilityFromWorkspace } from './traceability.js';
import type { CurrentSpecGraph } from './current-spec-graph.js';

export async function validateRelations(workspace: WorkspaceContext): Promise<CurrentSpecGraph> {
  const graph = await loadCurrentSpecGraph(workspace.paths);
  const trace = await validateCurrentSpecGraphTraceabilityFromWorkspace(workspace.paths, graph);
  if (!trace.valid) throw new Error(`当前规格关系追溯失败：${trace.issues.join('; ')}`);
  return graph;
}
