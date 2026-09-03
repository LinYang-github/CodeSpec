import type { CommandTemplate, SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { withOpenSpecWorkflowGuidance } from './openspec-workflow.js';

const ARCHIVE_INSTRUCTIONS = `归档一个已经完成并验证通过的 OpenSpec Change。

${STORE_SELECTION_GUIDANCE}

1. 运行 openspec context --json 和 openspec status --change "<CHG-ID>" --json，解析唯一 Change、schema、planningHome、changeRoot、artifactPaths、status、baseline 和验证证据。没有明确 Change、metadata 或路径存在歧义时停止，不得猜测。
2. Core 必须确认 Change 已完成、没有 STALE 或未裁决冲突，且 Requirement、Scenario、Task 与 verification 具备可追溯关系。未满足时返回 openspec-workflow 或 openspec-rebase-change，不得归档。
3. 如果存在 delta Spec，只能由 Core 的 archive 事务读取并校验；不得调用或推荐独立的同步入口。Core 在事务内部执行 validateRequirementDelta()、validateTraceability()、validateCanonicalSpec()、applyDelta() 和 detectArchiveConflict()。
4. 调用 openspec archive --change "<CHG-ID>"。Core 按 preflightArchive()、prepareArchive()、commitArchive() 和 archiveTransaction() 的顺序执行，成功后再移动 Change 到由 planningHome.changesDir 派生的 archive 目录。
5. 事务失败时不得保留半完成的 Current Specification 或半移动的 Change；输出失败原因和恢复动作，保留原始 Change 供再次处理。
6. 成功后重新运行 status，汇总 Change、schema、archive path、Current Specification 变化、验证证据和任何已确认的警告。

**唯一写入边界**：Current Specification 只能由 Core archive transaction 写入。Skill 不直接编辑 Spec、Change metadata 或 archive 目录。`;

export function getArchiveChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-archive-change',
    description: '通过 OpenSpec Core 事务校验并归档已完成的 Change。',
    instructions: withOpenSpecWorkflowGuidance(ARCHIVE_INSTRUCTIONS),
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxArchiveCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Archive Change',
    description: '通过 Core 事务提交 Current Specification 并归档 Change',
    category: 'Workflow',
    tags: ['workflow', 'archive', 'canonical'],
    content: withOpenSpecWorkflowGuidance(ARCHIVE_INSTRUCTIONS),
  };
}
