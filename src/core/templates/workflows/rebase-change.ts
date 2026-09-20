import type { CommandTemplate, SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { withCodeSpecWorkflowGuidance } from './codespec-workflow.js';

const REBASE_INSTRUCTIONS = `处理 CodeSpec Change 的 STALE、基线重建或多 Change 冲突。

${STORE_SELECTION_GUIDANCE}

1. 运行 \`codespec context --json\` 和 \`codespec status --change "<CHG-ID>" --json\`，确认唯一 Change、当前 baseline、STALE 状态和受影响 Requirement。
2. 只有在 Core 报告 baseline 过期、存在不可安全合并的多 Change 关系或用户明确要求重建基线时才执行 rebase。
3. 调用 \`codespec rebase --change "<CHG-ID>"\`。不要自行修改 metadata、revision、baseline、tasks、verification 或 archive 标记。
4. 若 Core 报告冲突或上下文不明确，列出冲突并停止，请用户裁决；不得猜测合并结果。
5. 成功后重新运行 status，读取 \`design.md\` 中追加的 Rebase decision。两条 route 都递增 Change revision：DESIGN 表示意图仍有效，只刷新 affected Requirement 的 Previous，保留 New/Reason/action；ANALYZE 表示意图或 Requirement 冲突，保留旧 analysis revision、baseline 和 Previous，先人工修订 \`analysis.yaml\` 解决冲突，不要重复 rebase。然后回到 \`codespec-workflow\`。

rebase 只负责恢复可开发状态；它不实现代码、不写 Current Specification，也不执行归档。`;

export function getRebaseChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'codespec-rebase-change',
    description: '处理 STALE、多 Change 冲突和基线重建。',
    instructions: withCodeSpecWorkflowGuidance(REBASE_INSTRUCTIONS),
    license: 'MIT',
    compatibility: 'Requires codespec CLI.',
    metadata: { author: 'codespec', version: '1.0' },
  };
}

export function getCodespecRebaseCommandTemplate(): CommandTemplate {
  return {
    name: 'CODESPEC: Rebase Change',
    description: '重建 STALE Change 的基线并恢复开发',
    category: 'Workflow',
    tags: ['workflow', 'rebase', 'stale'],
    content: withCodeSpecWorkflowGuidance(REBASE_INSTRUCTIONS),
  };
}
