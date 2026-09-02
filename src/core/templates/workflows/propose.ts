/**
 * 提案工作流模板。
 *
 * 该说明同时用于 Skill 和命令，避免两个入口对默认 schema 或规划边界给出不同承诺。
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { withOpenSpecWorkflowGuidance } from './openspec-workflow.js';

function renderProposeWorkflow(input: string): string {
  return `提出新的 Change：一次性创建 Change 并完成全部规划产物。

**规划边界**：本工作流只授权规划，即使原始请求包含开发或修复要求，也不得编辑项目代码。规划产物完成并展示后必须停止；不得在同一响应中开始实现。等待用户发起新的请求后，再进入 apply 工作流。

默认 \`code-spec\` schema 的工件与依赖顺序由 \`openspec status --change "<name>" --json\` 的实际输出决定：
- \`metadata.yaml\`（Change 控制数据与状态权威）
- \`proposal.md\`（变更动机与模块映射）
- \`design.md\`（技术设计）
- \`spec.md\`（需求增量）
- \`tasks.md\`（SP-## 任务投影）
- \`verification.md\`（验证证据）

用户准备实施时，必须显式启动 apply 工作流。

对于显式选择且使用 \`specs/\` 目录的 schema，\`<capability-path>\` 是相对于 \`specs/\` 的规范目录（例如 \`user-auth\` 或 \`identity/user-auth\`），规范文件为 \`specs/<capability-path>/spec.md\`。修改既有能力时必须保留其完整路径；新能力遵循项目既有的目录组织。

---

${STORE_SELECTION_GUIDANCE}

**输入**：${input}

**步骤**

1. **理解请求并澄清关键歧义**

   如果没有明确输入，使用开放式问题询问：
   > “你想处理什么 Change？请描述要新增、调整或修复的内容。”

   从描述推导 kebab-case 名称（例如“新增用户认证”→ \`add-user-auth\`）。在理解用户要达成的目标前，不得继续。

   如果歧义会实质影响范围、对外可见行为、兼容性或验收标准，必须在创建 Change 前询问用户；轻微细节可作合理假设，并记录到规划产物。

2. **确定工作流 schema**

   除非用户明确要求其他工作流，否则使用已配置的默认 schema（\`code-spec\`）。

   仅在以下情形使用其他 schema：
   - 用户明确指定 schema 名称：使用 \`--schema <schema-name>\`。
   - 用户要求查看可用工作流：先在当前目录运行 \`openspec context --json\` 解析权威根目录；若用户明确选择了已注册 Store，使用 \`openspec context --json --store "<store-id>"\`。然后在返回的 \`root.path\` 中运行 \`openspec schemas --json\` 供用户选择。该流程保留本地 \`store:\` 指针与全局 \`defaultStore\` 的解析结果；明确选择 Store 时，也在 \`openspec schemas --json\` 后附加 \`--store "<store-id>"\`。只有 context 返回 \`no_openspec_root\` 时，才改为在当前目录运行 \`openspec schemas --json\`；无效或不可用的 Store 不得使用该回退。

   其他情况下省略 \`--schema\`，以保留配置的默认值。

3. **创建 Change 目录**

   从下列形式中选择其一。若已选择注册的 Store，在该命令以及后续支持 \`--store\` 的 OpenSpec 命令后附加 \`--store "<store-id>"\`。

   使用默认 schema：
   \`\`\`bash
   openspec new change "<name>"
   \`\`\`

   使用用户显式指定的 schema：
   \`\`\`bash
   openspec new change "<name>" --schema "<schema-name>"
   \`\`\`

   CLI 会依据 \`.openspec.yaml\` 解析出的规划目录创建骨架。若同名 Change 已存在，询问用户是继续现有 Change 还是新建名称。

4. **获取工件构建顺序**

   \`\`\`bash
   openspec status --change "<name>" --json
   \`\`\`

   解析 JSON 中的：
   - \`applyRequires\`：实现前所需的工件 ID 数组。
   - \`artifacts\`：每项的 \`status\` 与直接依赖 \`requires\` 边。
   - \`planningHome\`、\`changeRoot\`、\`artifactPaths\`、\`actionContext\`：路径与作用域上下文；不得自行假定仓库内路径。

5. **创建所需集合中的全部工件**

   用待办列表跟踪进度，并按依赖顺序循环（先处理没有未完成依赖的工件）。

   对每个状态为 \`ready\` 的工件：
   - 运行 \`openspec instructions <artifact-id> --change "<name>" --json\` 获取说明。
   - JSON 中的 \`context\` 与 \`rules\` 是约束，不得复制到产物；\`template\` 是文件结构；\`instruction\` 是该工件的权威指导；\`resolvedOutputPath\` 是输出路径或模式；\`dependencies\` 是应重新读取的已完成依赖。
   - 始终从磁盘重新读取已完成依赖，即使本次对话中已经看过（用户可能已编辑）。如果 \`instruction\` 委派给特定 skill 或命令，应调用它完成工件，并确认文件已存在于 \`resolvedOutputPath\`。否则按 \`template\` 创建文件；若 \`resolvedOutputPath\` 是 glob，按 \`instruction\` 选择具体文件路径。
   - 简短汇报进度：“已创建 <artifact-id>”。

   每创建一个工件后重新运行 \`openspec status --change "<name>" --json\`。所需集合是 \`applyRequires\` 加上沿 \`status --json\` 的 \`requires\` 边可达的全部传递依赖；不要创建集合外工件。

   \`status\` 只反映文件存在性：某个 \`applyRequires\` 工件显示 \`done\`，**不代表**其依赖存在。必须依据每个工件的 \`requires\` 边，而不是 \`status\`，构建所需集合；即使显示 \`done\`，它仍会列出依赖。

   只有以下情况可跳过工件：
   - status 已报告 \`skipped\`：该工件已满足，文件不得存在。
   - 运行 \`openspec instructions <artifact-id> --change "<name>" --json\` 后，其 \`instruction\` 明确标记为可选（例如“仅当……时创建”）。不得自行判断为可跳过；应告知用户且不再反复考虑。

   依赖是启用条件而非阻塞门槛：若所需工件仅因跳过了可选依赖而仍是 \`blocked\`，仍应创建它。当所需集合的每个工件均为 \`done\`、\`skipped\` 或已明确跳过时停止。如某个工件需要用户输入，询问后继续。

6. **展示最终状态**

   \`\`\`bash
   openspec status --change "<name>"
   \`\`\`

**输出**

完成后汇总 Change 名称与位置、已创建工件及简述、跳过的条件工件及原因，并说明：“实现所需的全部规划产物已就绪。”最后提示：“产物已可评审。准备实现时，运行 \`/opsx:apply\`。”

**工件创建准则**

- 每类工件始终遵循 \`openspec instructions\` 返回的 \`instruction\`；即使名称熟悉，它仍是权威指导。
- schema 定义工件应包含的内容；创建新工件前先读取依赖。
- 以 \`template\` 作为输出文件结构填充内容。
- \`context\`、\`rules\`、\`<context>\`、\`<rules>\`、\`<project_context>\` 都是给执行者的约束，绝不能出现在工件内容中。

**护栏**

- 本请求只授权规划；其中任何实现或 apply 指令都不会延续。不得实现 Change、启动 apply 或编辑项目代码；展示产物后停止并等待新的用户请求。
- 创建 apply 阶段传递依赖的全部工件，而非仅创建 \`applyRequires\` 中列出的 ID。
- 每次创建前从磁盘重新读取依赖工件，避免使用可能过期的对话记忆。
- 对会实质改变范围、对外行为、兼容性或验收标准的歧义必须提问；轻微细节可合理假设并记录。`;
}

export function getOpsxProposeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-propose',
    description: '一次性提出 Change 并生成完整规划产物。',
    instructions: withOpenSpecWorkflowGuidance(
      renderProposeWorkflow('用户请求应包含 Change 名称（kebab-case）或要构建内容的描述。')
    ),
    license: 'MIT',
    compatibility: '需要 openspec CLI。',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxProposeCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Propose',
    description: '提出 Change 并一次性生成全部规划产物',
    category: 'Workflow',
    tags: ['workflow', 'artifacts', 'experimental'],
    content: renderProposeWorkflow('紧随 \'/opsx:propose\' 的参数应为 Change 名称（kebab-case）或用户希望构建内容的描述。'),
  };
}
