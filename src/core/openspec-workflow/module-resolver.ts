import type { BusinessModule, RequirementDelta, ModuleOutcome } from './types.js';

export interface ModuleResolutionItem {
  module: BusinessModule['id'] | null;
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
    if (typeof raw !== 'string' && raw.outcome === 'IRRELEVANT') {
      irrelevant.push(text);
      resolutions.push({ module: null, outcome: 'IRRELEVANT', reason: 'Explicitly classified as irrelevant', candidate: text });
      continue;
    }
    if (typeof raw !== 'string' && raw.module && raw.outcome) {
      const module = registry.modules.find((item) => item.id === raw.module);
      if (!module) throw new Error(`Unknown module ${raw.module}`);
      resolutions.push({ module: module.id, outcome: raw.outcome, reason: 'Explicit module outcome', candidate: text });
      continue;
    }
    const norm = (value: string) => value.toLocaleLowerCase('zh-CN');
    const needle = norm(text);
    const score = registry.modules.map((module) => {
      const responsibility = module.responsibilities.filter((item) => needle.includes(norm(item))).length;
      const semantic = specs.filter((spec) => spec.module === module.id).filter((spec) => {
        const content = norm(`${spec.next ?? ''} ${'previous' in spec ? spec.previous ?? '' : ''}`);
        return !!needle && (content.includes(needle) || needle.includes(content));
      }).length;
      const keyword = module.keywords.filter((item) => needle.includes(norm(item))).length;
      const display = [module.name, module.description ?? ''].filter((item) => item && needle.includes(norm(item))).length;
      return { module, rank: responsibility ? 4 : semantic ? 3 : keyword ? 2 : display ? 1 : 0, count: responsibility || semantic || keyword || display };
    }).filter((item) => item.rank > 0).sort((a, b) => b.rank - a.rank || b.count - a.count);
    const best = score[0];
    if (!best) {
      irrelevant.push(text);
      resolutions.push({ module: null, outcome: 'IRRELEVANT', reason: 'No module matched the candidate', candidate: text });
      continue;
    }
    if (score[1] && score[1].rank === best.rank && score[1].count === best.count) throw new Error(`Ambiguous module ownership for "${text}": score tie between ${best.module.id} and ${score[1].module.id}`);
    const isDependency = /依赖|调用|使用|外部|downstream|dependency/i.test(text);
    const outcome = isDependency ? 'DEPENDENCY' : 'OWNED';
    resolutions.push({ module: best.module.id, outcome, reason: isDependency ? `Candidate depends on ${best.module.name}` : `Matched ${best.module.name}`, candidate: text });
  }
  return { resolutions, irrelevant };
}
