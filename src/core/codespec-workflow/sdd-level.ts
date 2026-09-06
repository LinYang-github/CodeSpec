import type { ChangeMode, SddLevel } from './types.js';

export interface SddLevelAssessmentInput {
  mode: ChangeMode;
  scope: 'single-module' | 'cross-module';
  ownedModuleCount: number;
  affectedAreas: readonly string[];
}

export interface SddLevelAssessment {
  minimum: SddLevel;
  reasons: string[];
}

const LEVEL_THREE_RISK = /(?:api|interface|接口|data|数据库|数据|migration|迁移|security|安全|auth|认证|architecture|架构|release|发布|rollout|灰度|rollback|回滚|performance|性能)/iu;

/**
 * Produces a transparent lower bound for the metadata-authoritative SDD
 * level. Authors may raise the level, but cannot select one below this bound.
 */
export function evaluateMinimumSddLevel(input: SddLevelAssessmentInput): SddLevelAssessment {
  const riskyAreas = input.affectedAreas.filter((area) => LEVEL_THREE_RISK.test(area));
  if (riskyAreas.length > 0) {
    return {
      minimum: 3,
      reasons: [`affected_areas 声明了高风险范围：${riskyAreas.join('、')}`],
    };
  }

  if (input.mode !== 'bugfix') {
    return { minimum: 2, reasons: ['feature 或 refactor 至少使用 Level 2'] };
  }

  if (input.scope !== 'single-module' || input.ownedModuleCount !== 1) {
    return { minimum: 2, reasons: ['跨模块或非单一 OWNED 模块的 bugfix 至少使用 Level 2'] };
  }

  return { minimum: 1, reasons: [] };
}
