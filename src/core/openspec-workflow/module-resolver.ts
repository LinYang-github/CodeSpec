import type { BusinessModule, RequirementDelta, ModuleOutcome } from './types.js';

export interface ModuleResolutionItem {
  module: BusinessModule['id'];
  outcome: ModuleOutcome;
  reason: string;
  candidate: string;
}
export interface ModuleResolution { resolutions: ModuleResolutionItem[]; irrelevant: string[] }

export function resolveModuleOwnership(
  registry: { modules: BusinessModule[] },
  candidates: Array<string | { module?: string; text?: string; outcome?: ModuleOutcome }>,
  specs: Array<RequirementDelta | { id?: string; module?: string; next?: string }>
): ModuleResolution {
  const resolutions: ModuleResolutionItem[] = [];
  const irrelevant: string[] = [];
  for (const raw of candidates) {
    const text = typeof raw === 'string' ? raw : raw.text ?? raw.module ?? '';
    const scores = registry.modules.map((module) => {
      const haystack = [...module.responsibilities, ...module.keywords, module.name].join(' ');
      const direct = typeof raw !== 'string' && raw.module === module.id;
      const matches = [...new Set(haystack.split(/[，,;；\s]+/u).filter(Boolean))].filter((word) => text.includes(word)).length;
      return { module, score: direct ? 100 : matches };
    }).sort((a, b) => b.score - a.score);
    const best = scores[0];
    if (!best || best.score === 0) { irrelevant.push(text); continue; }
    if (scores[1]?.score === best.score) throw new Error(`Ambiguous module ownership for "${text}": score tie between ${best.module.id} and ${scores[1].module.id}`);
    const specMatch = specs.some((spec) => spec.module === best.module.id && (spec.next ?? '').includes(text));
    if (!specMatch && specs.length > 0 && !text.includes(best.module.name)) { irrelevant.push(text); continue; }
    const isDependency = /依赖|调用|使用|外部|downstream|dependency/i.test(text) && !(typeof raw !== 'string' && raw.module);
    resolutions.push({ module: best.module.id, outcome: isDependency ? 'DEPENDENCY' : 'OWNED', reason: isDependency ? `Candidate depends on ${best.module.name}` : `Matched ${best.module.name}`, candidate: text });
  }
  return { resolutions, irrelevant };
}
