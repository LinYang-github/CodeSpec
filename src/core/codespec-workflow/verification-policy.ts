import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

import type { ConfigurationSnapshot } from './current-spec-yaml.js';
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

function hasInterpolation(value: string): boolean {
  return /\$\{|\$[A-Za-z_]/u.test(value);
}

function resolveJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '/') return value;
  return pointer.slice(1).split('/').reduce<unknown>((current, rawSegment) => {
    const segment = rawSegment.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

async function resolveConfigurationSource(projectRoot: string, source: ConfigurationSnapshot['profiles'][number]['services'][number]['source']): Promise<string> {
  const file = path.resolve(projectRoot, source.file);
  const relative = path.relative(projectRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source file is outside the project');
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('source file must be a regular repository file');
  const raw = await fs.readFile(file, 'utf8');
  if (source.format === 'dotenv') {
    const line = raw.split(/\r?\n/u).find((candidate) => candidate.trim().startsWith(`${source.key}=`));
    if (!line) throw new Error('source key is missing');
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/gu, '');
    if (!value || hasInterpolation(value)) throw new Error('source value is empty or interpolated');
    return value;
  }
  const document = source.format === 'json' ? JSON.parse(raw) : parseYaml(raw);
  const value = resolveJsonPointer(document, source.key);
  if (typeof value !== 'string' || !value || hasInterpolation(value)) throw new Error('source key is missing, non-string, or interpolated');
  return value;
}

/** Validates runtime endpoints using aliases and source keys only; raw values never enter errors. */
export async function validateRuntimeConfiguration(projectRoot: string, configuration: ConfigurationSnapshot): Promise<string[]> {
  const errors: string[] = [];
  for (const profile of configuration.profiles) {
    for (const service of profile.services) {
      try {
        const value = await resolveConfigurationSource(projectRoot, service.source);
        if (service.endpoint && value !== service.endpoint) throw new Error('resolved endpoint does not match snapshot');
        if (service.endpointFingerprint) {
          const fingerprint = `sha256:${createHash('sha256').update(value).digest('hex')}`;
          if (fingerprint !== service.endpointFingerprint) throw new Error('resolved endpoint fingerprint does not match snapshot');
        }
      } catch (error) {
        errors.push(`运行配置 ${profile.id}/${service.hostAlias}（${service.source.file}#${service.source.key}）无效：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return errors;
}
