/** 创建 canonical Change 的逐步工作流模板。 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

function renderNewChangeWorkflow(input: string): string {
  return `开始新的 Change：创建 canonical 骨架并展示第一个待完成工件，不直接编写任何工件。

默认 schema 为 \`code-spec\`。默认工件顺序必须以 \`openspec status --change "<name>" --json\` 的实际输出为准，通常包括 \`metadata.yaml\`、\`proposal.md\`、\`design.md\`、\`spec.md\`、\`tasks.md\` 和 \`verification.md\`。

${STORE_SELECTION_GUIDANCE}

**输入**：${input}

**步骤**

1. **理解请求**

   若输入不明确，开放式询问：“你想处理什么 Change？请描述要新增、调整或修复的内容。”从描述推导 kebab-case 名称（例如“新增用户认证”→ \`add-user-auth\`）。在理解目标前不得继续。

2. **确定 schema**

   除非用户明确要求其他 schema，否则省略 \`--schema\` 并使用默认的 \`code-spec\`。用户明确指定 schema 时使用 \`--schema <name>\`；用户要求查看可用工作流时，运行 \`openspec context --json\` 解析根目录后，在返回的 \`root.path\` 中运行 \`openspec schemas --json\` 供其选择。

3. **创建 Change 目录**

   \`\`\`bash
   openspec new change "<name>"
   \`\`\`

   仅在用户指定其他 schema 时追加 \`--schema <name>\`。如已选择注册 Store，在此后支持该选项的命令中持续附加 \`--store "<store-id>"\`。CLI 会在解析出的规划目录创建 Change 骨架；不得手工创建 Change 目录。若同名 Change 已存在，建议继续现有 Change。

4. **展示工件状态**

   \`\`\`bash
   openspec status --change "<name>" --json
   \`\`\`

   使用返回的 \`planningHome\`、\`changeRoot\`、\`artifactPaths\`、\`actionContext\` 和 \`nextSteps\`，不得自行假定仓库内路径。

5. **获取第一个工件的说明**

   从 status 输出选择第一个 \`status: "ready"\` 的工件，然后运行：
   \`\`\`bash
   openspec instructions <first-artifact-id> --change "<name>" --json
   \`\`\`

   该命令返回模板、上下文与工件指导。

6. **停止并等待用户指示**

**输出**

汇总 Change 名称与位置、使用的 schema 和工件序列、当前进度、首个工件模板，并提示：“已准备好创建第一个工件。请描述这个 Change 的具体内容，或要求我继续。”

**护栏**

- 不创建任何工件，只展示第一个工件说明。
- 不得越过首个工件模板继续执行。
- 名称不符合 kebab-case 时要求用户提供有效名称。
- 使用非默认 schema 时传入 \`--schema\`。`;
}

export function getNewChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-new-change',
    description: '按步骤创建 OpenSpec Change 并准备第一个产物。',
    instructions: renderNewChangeWorkflow('用户请求应包含 Change 名称（kebab-case）或要构建内容的描述。'),
    license: 'MIT',
    compatibility: '需要 openspec CLI。',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxNewCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: 新建',
    description: '按步骤开始新的 Change（OPSX）',
    category: 'Workflow',
    tags: ['workflow', 'artifacts', 'experimental'],
    content: renderNewChangeWorkflow('紧随 \'/opsx:new\' 的参数应为 Change 名称（kebab-case）或用户希望构建内容的描述。'),
  };
}
