/** 续办 canonical Change 的工作流模板。 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

function renderContinueWorkflow(input: string): string {
  return `继续处理现有 Change：每次仅创建一个由 canonical status 指定的下一个工件。

${STORE_SELECTION_GUIDANCE}

**输入**：${input}

**步骤**

1. **选择 Change**

   用户提供了明确的 \`CHG-YYYYMMDD-NNN\` 时使用该 ID；否则从对话上下文推断。若只有一个活动 Change 可自动选择；如仍有歧义，运行 \`openspec list --json\`，按最近修改时间展示 3–4 个候选，让用户选择。候选展示 Change ID、schema、状态和最后修改时间；将最近修改项标为“推荐”。明确说明：“正在使用 Change：<id>”，并提示可用 \`/opsx:continue <CHG-ID>\` 覆盖。

2. **检查 canonical 状态**

   \`\`\`bash
   openspec status --change "<CHG-ID>" --json
   \`\`\`

   读取 \`schemaName\`、\`artifacts\`、\`isPlanningComplete\`、\`planningHome\`、\`changeRoot\`、\`artifactPaths\` 与 \`actionContext\`。使用返回的路径，不得假设仓库内路径。

3. **根据状态执行**

   若 \`isPlanningComplete: true\`，展示最终状态，说明规划已完成，可在新的用户请求中进入 apply；然后停止。

   否则选择 status 中第一个 \`status: "ready"\` 的工件，运行：
   \`\`\`bash
   openspec instructions <artifact-id> --change "<CHG-ID>" --json
   \`\`\`

   \`instruction\` 是权威指导，\`template\` 是文件结构，\`context\` 与 \`rules\` 仅是约束，绝不能复制到产物。始终从磁盘重新读取 \`dependencies\`；若说明委派给特定 skill 或命令，调用它完成工件并验证 \`resolvedOutputPath\` 存在。否则按 \`template\` 写入 \`resolvedOutputPath\`；路径为 glob 时按 \`instruction\` 选择具体路径。展示已创建的工件和新解锁项，然后停止。

   若没有 \`ready\` 工件，展示状态并提示检查 schema 或依赖问题。

4. **展示进度**

   \`\`\`bash
   openspec status --change "<CHG-ID>"
   \`\`\`

**输出**

每次调用说明创建了哪个工件、当前 schema、N/M 完成进度、已解锁工件，并提示：“需要继续时，运行 \`/opsx:continue\` 或直接告诉我下一步。”

**护栏**

- 每次调用只创建一个工件。
- 始终依据 schema 的工件序列，不得猜测工件名称或跳过、乱序创建。
- 上下文关键部分不明确时，先询问用户。
- 写入后确认工件文件存在，再报告进度。
- \`context\`、\`rules\`、\`<context>\`、\`<rules>\`、\`<project_context>\` 是约束，绝不能写入工件。`;
}

export function getContinueChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-continue-change',
    description: '继续处理 OpenSpec Change，并创建下一个工件。',
    instructions: renderContinueWorkflow('可选地提供 Change ID；省略时从上下文解析或要求选择。'),
    license: 'MIT',
    compatibility: '需要 openspec CLI。',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxContinueCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: 继续',
    description: '继续处理 Change 并创建下一个工件',
    category: 'Workflow',
    tags: ['workflow', 'artifacts', 'experimental'],
    content: renderContinueWorkflow('紧随 \'/opsx:continue\' 的参数可选地指定 Change ID（例如 \`/opsx:continue CHG-20260902-001\`）。'),
  };
}
