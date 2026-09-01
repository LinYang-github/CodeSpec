import path from 'node:path';
import { archiveChange, type ArchiveResult } from './openspec-workflow/archive-transaction.js';
import { loadWorkspace } from './openspec-workflow/loaders.js';

/** Canonical code-spec archive entry point. Legacy Change directories are not accepted. */
export async function archiveBusinessChange(projectRoot: string, changeId: string): Promise<ArchiveResult> {
  if (!/^CHG-\d{8}-\d{3}$/.test(changeId)) throw new Error('Canonical archive requires a CHG-YYYYMMDD-NNN Change ID');
  return archiveChange(await loadWorkspace(path.join(projectRoot, 'openspec')), changeId);
}
