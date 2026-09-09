export interface CurrentArchivePreflightInput {
  designApproved?: boolean;
  planApproved: boolean;
  taskStatuses: Array<'PENDING' | 'IN_PROGRESS' | 'DONE'>;
  verificationErrors: string[];
}

export function validateCurrentArchivePreflight(input: CurrentArchivePreflightInput): string[] {
  const errors: string[] = [];
  if (input.designApproved === false) errors.push('Design approval is required before archive');
  if (!input.planApproved) errors.push('Task approval is required before archive');
  if (input.taskStatuses.some((status) => status !== 'DONE')) errors.push('All current Change tasks must be DONE');
  errors.push(...input.verificationErrors);
  return errors;
}
