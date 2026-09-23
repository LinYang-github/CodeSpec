import type { CommandTemplate, SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { withCodeSpecWorkflowGuidance } from './codespec-workflow.js';

const ARCHIVE_INSTRUCTIONS = `归档一个已经完成并验证通过的 CodeSpec Change。

${STORE_SELECTION_GUIDANCE}

1. 运行 codespec context --json 和 codespec status --change "<CHG-ID>" --json，解析唯一 Change、schema、planningHome、changeRoot、artifactPaths、status、baseline 和验证证据。没有明确 Change、metadata 或路径存在歧义时停止，不得猜测。
2. Core 必须确认 analyze/design/plan 三审批仍有效、没有 STALE 或未裁决冲突，且 AC、Requirement、Scenario、Task、Test 与 Evidence 具备可追溯关系。未满足时返回 codespec-workflow 或 codespec-rebase-change，不得归档。
3. Core 必须读取并校验 Change 的 analysis.yaml、metadata.yaml、design.md、spec.md、tasks.yaml 和 verification.yaml，再把该 Change 的模块内容直接合并到 \`specs/<模块>/spec.md\`、\`interface.yaml\` 和 \`api.yaml\`。三个文件均不存在时由归档事务一次性创建；已有文件时基于 Current 内容补充或修改；只有部分文件存在时停止并报错。
4. UI Change 必须具备真实工程启动命令和浏览器 E2E 标识；归档时 Core 会重新启动工程、等待配置快照中的服务就绪并执行浏览器 E2E。缺少任一条件或执行失败都不得归档。非 UI Change 按既定验证证据执行。
5. 展示待归档摘要后停止，要求用户在交互式终端运行 \`codespec archive "<CHG-ID>"\` 并亲自确认。不得替用户调用归档，也不得使用 \`--yes\`、\`--json\` 或其他自动化方式绕过确认。确认后 Core 才通过 commitConfirmedArchive() 提交已确认的 preflightArchive() 和 prepareArchive() 结果；UI Change 会先刷新验证，任何输入变化都会使确认失效。
6. 事务失败时不得保留半完成的 Current Specification 或半移动的 Change；输出失败原因和恢复动作，保留原始 Change 供再次处理。
7. 成功后检查 Current Specification，汇总 Requirement merge、验证证据和已确认的警告。Current 保留 \`specs/<模块>/{spec.md,interface.yaml,api.yaml}\` 及根级 \`business.yaml\`、\`configuration.yaml\`。活动 Change 已删除，且不得创建 \`codespec/archive/\` 或 Change 副本。

**唯一写入边界**：Current Specification 只能由 Core archive transaction 写入。Skill 不直接编辑 Current Specification 或 Change metadata。`;

export function getArchiveChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'codespec-archive-change',
    description: '通过 CodeSpec Core 事务校验并归档已完成的 Change。',
    instructions: withCodeSpecWorkflowGuidance(ARCHIVE_INSTRUCTIONS),
    license: 'MIT',
    compatibility: 'Requires codespec CLI.',
    metadata: { author: 'codespec', version: '1.0' },
  };
}

export function getCodespecArchiveCommandTemplate(): CommandTemplate {
  return {
    name: 'CODESPEC: Archive Change',
    description: '通过 Core 事务提交 Current Specification 并归档 Change',
    category: 'Workflow',
    tags: ['workflow', 'archive', 'canonical'],
    content: withCodeSpecWorkflowGuidance(ARCHIVE_INSTRUCTIONS),
  };
}
