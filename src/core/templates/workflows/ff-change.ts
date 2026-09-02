/** 快进创建规划工件的工作流模板。 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

function renderFastForwardWorkflow(input: string): string {
  return `快速完成规划工件创建：一次性生成开始实现所需的全部工件。

默认使用 \`code-spec\` schema。工件和依赖顺序必须以 \`openspec status --change "<name>" --json\` 的实际输出为准；默认工件包括 \`metadata.yaml\`、\`proposal.md\`、\`design.md\`、\`spec.md\`、\`tasks.md\` 和 \`verification.md\`。

${STORE_SELECTION_GUIDANCE}

**输入**：${input}

**步骤**

1. **理解请求**

   若输入不清晰，开放式询问：“你想处理什么 Change？请描述要新增、调整或修复的内容。” 从描述推导 kebab-case 名称（例如“新增用户认证”→ \`add-user-auth\`）。未理解目标前不得继续。

2. **创建 Change 目录**

   \`\`\`bash
   openspec new change "<name>"
   \`\`\`

   若用户明确指定了其他 schema，使用 \`openspec new change "<name>" --schema "<schema-name>"\`。若已选择注册的 Store，在所有支持的命令后附加 \`--store "<store-id>"\`。CLI 会在由配置解析的规划目录创建骨架；同名 Change 存在时，询问用户是否继续。

3. **获取工件构建顺序**

   \`\`\`bash
   openspec status --change "<name>" --json
   \`\`\`

   解析 \`applyRequires\`、每个工件的 \`status\` 与 \`requires\` 边，以及 \`planningHome\`、\`changeRoot\`、\`artifactPaths\`、\`actionContext\`。必须使用返回的路径与作用域，不得自行假定仓库内路径。

4. **创建所需集合中的全部工件**

   用待办列表跟踪进度，并按依赖顺序循环。对每个 \`ready\` 工件：
   - 运行 \`openspec instructions <artifact-id> --change "<name>" --json\`。
   - 将 \`context\` 与 \`rules\` 仅用作约束，绝不复制到产物；按 \`template\` 和 \`instruction\` 创建文件。若说明委派给特定 skill 或命令，调用它完成工件，然后验证 \`resolvedOutputPath\` 已存在。若路径是 glob，按 \`instruction\` 选择具体路径。
   - 每次都从磁盘重新读取已完成的 \`dependencies\`，即使本次对话已经读取过。
   - 简短汇报：“已创建 <artifact-id>”。

   每创建一个工件后重跑 \`openspec status --change "<name>" --json\`。所需集合是 \`applyRequires\` 加上沿 \`status --json\` 的 \`requires\` 边可达的全部传递依赖；不要创建集合外工件。

   \`status\` 只反映文件存在性。\`applyRequires\` 工件显示 \`done\` **不代表**依赖存在；必须根据每个工件的 \`requires\` 边而非 \`status\` 建立所需集合，即使 \`done\` 工件仍会列出其依赖。

   仅可跳过已显示 \`status: "skipped"\` 的工件（其文件不得存在），或在运行 \`openspec instructions <artifact-id> --change "<name>" --json\` 后、\`instruction\` 明确标记为可选的工件。不得自行判断跳过；应告知用户且不再反复考虑。依赖是启用条件而非阻塞门槛：若工件仅因跳过可选依赖而 \`blocked\`，仍应创建它。直到所需集合的每项均为 \`done\`、\`skipped\` 或已明确跳过才停止。

5. **展示最终状态**

   \`\`\`bash
   openspec status --change "<name>"
   \`\`\`

**输出**

汇总 Change 名称、位置、已创建工件、跳过原因，并说明：“实现所需的全部规划产物已就绪。准备实现时，运行 \`/opsx:apply\`。”

**护栏**

- 每类工件以 \`openspec instructions\` 的 \`instruction\` 为权威指导；schema 决定工件内容，\`template\` 决定文件结构。
- \`context\`、\`rules\`、\`<context>\`、\`<rules>\`、\`<project_context>\` 是约束，不得写入工件。
- 创建 apply 阶段传递依赖的全部工件，而非仅创建 \`applyRequires\` 中列出的 ID。
- 每次创建前从磁盘重读依赖；关键上下文不明确时询问用户，但轻微细节作合理决定并记录。
- 完成后验证每个工件文件存在。`;
}

export function getFfChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-ff-change',
    description: '快速创建开始实现所需的全部 OpenSpec 规划工件。',
    instructions: renderFastForwardWorkflow('用户请求应包含 Change 名称（kebab-case）或要构建内容的描述。'),
    license: 'MIT',
    compatibility: '需要 openspec CLI。',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxFfCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: 快进',
    description: '一次性创建 Change 并生成实现所需的全部规划工件',
    category: 'Workflow',
    tags: ['workflow', 'artifacts', 'experimental'],
    content: renderFastForwardWorkflow('紧随 \'/opsx:ff\' 的参数应为 Change 名称（kebab-case）或用户希望构建内容的描述。'),
  };
}
