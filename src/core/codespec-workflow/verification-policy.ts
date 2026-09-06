import type { SddLevel } from './types.js';

/** Categories a CodeSpec workspace may explicitly configure and execute. */
export const verificationKinds = [
  'unit',
  'typecheck',
  'build',
  'lint',
  'bdd',
  'integration',
  'security',
  'migration',
  'performance',
  'archive-regression',
] as const;

export type ControlledVerificationKind = (typeof verificationKinds)[number];

export interface VerificationPolicyInput {
  level: SddLevel;
  affectedAreas: readonly string[];
  archiveAffected: boolean;
}

export interface VerificationCommandDeclaration {
  command?: string;
  not_applicable_reason?: string;
}

export type VerificationCommandDeclarations = Partial<Record<ControlledVerificationKind, VerificationCommandDeclaration>>;

export type ResolvedVerificationCommand =
  | { kind: ControlledVerificationKind; command: string }
  | { kind: ControlledVerificationKind; notApplicableReason: string };

const areaMatches = (areas: readonly string[], pattern: RegExp): boolean =>
  areas.some((area) => pattern.test(area));

/**
 * Computes the smallest executable CI category set for a Change.
 *
 * This is intentionally a pure policy function: configuration decides the
 * command for a category, while the Change's declared Level decides whether
 * that category must be represented by successful evidence.
 */
export function requiredVerificationKinds(input: VerificationPolicyInput): ControlledVerificationKind[] {
  const required: ControlledVerificationKind[] = ['unit', 'typecheck', 'build', 'lint'];

  if (input.level >= 2) required.push('bdd', 'integration');
  if (input.level === 3) {
    if (areaMatches(input.affectedAreas, /security|auth|认证|授权|安全/iu)) required.push('security');
    if (areaMatches(input.affectedAreas, /migration|迁移|数据搬迁|数据迁入|数据迁出/iu)) required.push('migration');
    if (areaMatches(input.affectedAreas, /performance|性能|吞吐|延迟/iu)) required.push('performance');
  }
  if (input.archiveAffected) required.push('archive-regression');

  return required;
}

/**
 * Selects only policy-required categories from trusted workspace configuration.
 * A category cannot disappear because a project lacks a matching script: it
 * needs either an executable command or an explicit reason for inapplicability.
 */
export function resolveControlledVerificationCommands(
  declarations: VerificationCommandDeclarations,
  input: VerificationPolicyInput,
): ResolvedVerificationCommand[] {
  return requiredVerificationKinds(input).map((kind) => {
    const declaration = declarations[kind];
    const command = declaration?.command?.trim();
    const reason = declaration?.not_applicable_reason?.trim();
    if (Boolean(command) === Boolean(reason)) {
      throw new Error(`受控验证类别 ${kind} 必须配置 command 或 not_applicable_reason，且只能二选一。`);
    }
    return command ? { kind, command } : { kind, notApplicableReason: reason! };
  });
}
