import type { CommandTemplate, SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { withOpenSpecWorkflowGuidance } from './openspec-workflow.js';

const REBASE_INSTRUCTIONS = `处理 OpenSpec Change 的 STALE、基线重建或多 Change 冲突。

${STORE_SELECTION_GUIDANCE}

1. 运行 \`openspec context --json\` 和 \`openspec status --change "<CHG-ID>" --json\`，确认唯一 Change、当前 baseline、STALE 状态和受影响 Requirement。
2. 只有在 Core 报告 baseline 过期、存在不可安全合并的多 Change 关系或用户明确要求重建基线时才执行 rebase。
3. 调用 \`openspec rebase --change "<CHG-ID>"\`。不要自行修改 metadata、revision、baseline、tasks、verification 或 archive 标记。
4. 若 Core 报告冲突或上下文不明确，列出冲突并停止，请用户裁决；不得猜测合并结果。
5. 成功后重新运行 status，确认 Change 回到设计阶段、revision 已递增且新 baseline 已捕获，然后回到 \`openspec-workflow\`。

rebase 只负责恢复可开发状态；它不实现代码、不写 Current Specification，也不执行归档。`;

export function getRebaseChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-rebase-change',
    description: '处理 STALE、多 Change 冲突和基线重建。',
    instructions: withOpenSpecWorkflowGuidance(REBASE_INSTRUCTIONS),
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxRebaseCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Rebase Change',
    description: '重建 STALE Change 的基线并恢复开发',
    category: 'Workflow',
    tags: ['workflow', 'rebase', 'stale'],
    content: withOpenSpecWorkflowGuidance(REBASE_INSTRUCTIONS),
  };
}
