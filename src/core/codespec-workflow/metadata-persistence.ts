import type { ChangeMetadata } from './types.js';

/**
 * Keeps the source-level compatibility boundary intact while metadata is
 * normalized in memory. Task 10 owns the explicit persistent upgrade.
 */
export function metadataForPersistence(metadata: ChangeMetadata): object {
  if (metadata.artifacts.analysis) return metadata;
  const { analyze: _analyze, ...legacyApprovals } = metadata.approvals;
  return { ...metadata, approvals: legacyApprovals };
}
