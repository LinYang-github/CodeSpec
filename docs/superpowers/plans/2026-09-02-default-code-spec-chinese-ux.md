# 默认 code-spec 与中文用户体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `openspec init` 默认创建并迁移到 canonical `code-spec` 项目，同时将 OpenSpec 的所有面向用户自然语言统一为中文。

**Architecture:** 抽取唯一的 canonical 配置/骨架渲染器，由初始化和 store 根目录共用；初始化先识别配置状态，再以原子操作执行 code-spec 覆盖和旧索引隔离。用户界面通过统一的中文状态标签、诊断文案和模板源文件实现，机器协议值、命令、路径、ID 和 DSL 保持英文。

**Tech Stack:** TypeScript, Node.js, Commander, Zod, YAML, Vitest, ESLint, pnpm。

**Spec:** `docs/superpowers/specs/2026-09-02-default-code-spec-chinese-ux-design.md`

## Global Constraints

- `openspec init` 默认写入 `schema: code-spec`。
- 已有 `openspec/config.yaml` 时，`init` 自动覆盖为 canonical 配置，不再等待交互确认。
- 已有旧文件不删除、不移动，但不再参与 Change、状态、校验、归档和索引解析。
- 已有 `code-spec` 配置和有效活动 Change 不重置；只有从旧配置切换时才重建 canonical 空索引。
- CLI、Skill、模板和文档的自然语言使用中文；命令名、参数名、环境变量、路径、YAML/JSON key、schema 名称、稳定 ID、状态枚举和 DSL Token 保持英文。
- 人类状态输出使用中文标签加英文协议值，例如 `状态：分析（ANALYZE）`；JSON 和文件内容保持英文稳定值。
- 不删除、不递归清理旧 Change、旧规格或用户 Skill 文件。
- 配置覆盖和索引重建必须原子写入；验证失败时保留原文件。

---

### Task 1: 统一 canonical 默认配置渲染器

**Files:**
- Create: `src/core/openspec-workflow/default-config.ts`
- Modify: `src/core/init.ts:90-130,1141-1162`
- Modify: `src/core/openspec-root.ts:1-20,250-275`
- Modify: `src/commands/workflow/shared.ts:70-72`
- Test: `test/core/openspec-default-config.test.ts`
- Test: `test/core/openspec-root.test.ts`

**Interfaces:**
- Produces `CANONICAL_SCHEMA = 'code-spec'`、`renderCanonicalWorkspaceConfig(projectName, context?)`、`renderBusinessTemplate()`、`renderEmptyChangeIndex()`。
- `renderCanonicalWorkspaceConfig` 必须输出 `version`、`schema`、`project.name`、六个 `paths` 字段、`workflow`、`requirements`、`changes` 和 `archive` 配置，路径与设计文档中的 canonical 结构一致。
- `src/core/init.ts` 和 `src/core/openspec-root.ts` 不再各自维护默认 schema 或重复的 YAML 文本。

- [ ] **Step 1: 写失败测试**

```ts
it('renders a complete canonical code-spec config', () => {
  const config = parseWorkspaceConfig(
    parseYaml(renderCanonicalWorkspaceConfig('demo'))
  );
  expect(config.schema).toBe('code-spec');
  expect(config.project.name).toBe('demo');
  expect(config.paths).toEqual({
    business: 'business.md',
    changes: 'changes',
    change_index: 'changes/index.yaml',
    archive: 'archive',
    specs: 'archive/specs',
    archived_changes: 'archive/changes',
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run test/core/openspec-default-config.test.ts test/core/openspec-root.test.ts`

Expected: FAIL because the shared renderer and `code-spec` default are not yet present.

- [ ] **Step 3: 实现最小配置抽取**

将 `renderCanonicalWorkspaceConfig` 移入 `default-config.ts`，把项目名作为参数而不是固定 `demo`；将 `DEFAULT_SCHEMA` 与 `DEFAULT_OPENSPEC_SCHEMA` 指向 `CANONICAL_SCHEMA`。store 根目录使用 `path.basename(storeRoot)` 作为项目名，并调用同一 renderer。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run test/core/openspec-default-config.test.ts test/core/openspec-root.test.ts`

Expected: PASS，且 `ensureOpenSpecRoot` 生成的配置能通过 `parseWorkspaceConfig`。

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/default-config.ts src/core/init.ts src/core/openspec-root.ts src/commands/workflow/shared.ts test/core/openspec-default-config.test.ts test/core/openspec-root.test.ts
git commit -m "feat: make code-spec the canonical default"
```

### Task 2: 实现 init 的自动覆盖与旧文件隔离

**Files:**
- Modify: `src/core/init.ts:280-365,913-930,1141-1162,1525-1565`
- Modify: `src/core/file-state.ts`（复用现有原子写入接口；仅在缺少覆盖能力时补充）
- Test: `test/core/init.test.ts`
- Test: `test/cli-e2e/basic.test.ts`

**Interfaces:**
- `createConfig` 接收目标 schema 和迁移结果，返回 `created`、`overwritten`、`preserved` 或 `skipped`，供成功输出使用。
- 新增内部迁移判定：无配置 => `created`；解析到 `schema: spec-driven` => `overwritten` 并请求重建空 canonical 索引；解析到 `schema: code-spec` => `preserved`，不重置有效活动 Change；损坏/未知配置 => 抛出中文诊断并保留原文件。
- `initializeCodeSpecWorkspace` 创建 `business.md`、`changes/index.yaml`、`archive/README.md` 和 `archive/specs`/`archive/changes`；已有 `business.md` 保留，旧 Change 目录不删除。

- [ ] **Step 1: 写失败测试**

在 `test/core/init.test.ts` 增加三个场景：空目录初始化生成 `schema: code-spec`；旧 `schema: spec-driven` 配置被覆盖且旧 Change 文件仍存在、索引变为 `version: 1\nchanges: []\n`；已有 canonical 配置和活动 Change 再次 init 后索引内容不变。

```ts
expect(await fs.readFile(configPath, 'utf8')).toContain('schema: code-spec');
expect(await fs.readFile(legacyChangePath, 'utf8')).toBe('legacy');
expect(await fs.readFile(indexPath, 'utf8')).toBe('version: 1\nchanges: []\n');
```

在 `test/cli-e2e/basic.test.ts` 断言人类输出包含中文的配置状态与下一步提示。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run test/core/init.test.ts test/cli-e2e/basic.test.ts -t "code-spec|canonical|中文|legacy"`

Expected: FAIL because existing config is currently reported as `exists` and not overwritten.

- [ ] **Step 3: 实现自动迁移**

在写入前读取并分类配置；仅把明确解析为旧 `spec-driven` 的配置视为可自动覆盖。通过现有 `FileSystemUtils.writeFile`/原子写入路径写入 canonical 配置。旧配置切换时先将 canonical 空索引写入临时文件再替换，业务文件只在缺失时创建；已有 canonical 配置不清空索引。

增加 `openspec init --schema <code-spec|spec-driven>`，默认值为 `code-spec`。显式选择 `spec-driven` 时保留通用 schema 初始化；默认路径和自动迁移路径只进入 canonical code-spec。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run test/core/init.test.ts test/cli-e2e/basic.test.ts`

Expected: PASS；旧文件仍在，新流程只读取 canonical 索引中的 Change。

- [ ] **Step 5: Commit**

```bash
git add src/core/init.ts src/core/file-state.ts test/core/init.test.ts test/cli-e2e/basic.test.ts
git commit -m "feat: migrate initialized projects to code-spec"
```

### Task 3: 固化 canonical workspace 检测与 CLI 默认行为

**Files:**
- Modify: `src/commands/workflow/shared.ts:70-110`
- Modify: `src/commands/workflow/new-change.ts:95-180`
- Modify: `src/commands/workflow/status.ts:90-240`
- Modify: `src/commands/show.ts:35-105`
- Modify: `src/commands/validate.ts:210-330`
- Modify: `src/cli/index.ts:380-560,700-780`
- Test: `test/commands/artifact-workflow.test.ts`
- Test: `test/core/openspec-workflow/legacy-rejection.test.ts`
- Test: `test/cli-e2e/openspec-workflow-journeys.test.ts`

**Interfaces:**
- 默认 root/schema 解析为 `code-spec`；canonical workspace 通过 `schema: code-spec` 和完整 paths 进入新 loader。
- `new change` 自动分配 `CHG-YYYYMMDD-NNN`；legacy slug 在 canonical workspace 中继续明确拒绝。
- 旧 `changes/` 文件不在 canonical `index.yaml` 中时，批量 status/show/validate 不加载它们。

- [ ] **Step 1: 写失败测试**

增加空项目/自动迁移后端到 `new change` 的 CLI 测试，断言 JSON 中 `schema` 为 `code-spec`、Change ID 匹配 `/^CHG-\d{8}-\d{3}$/`，并断言旧 slug 输出中文错误但保留英文 ID 规则。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run test/commands/artifact-workflow.test.ts test/core/openspec-workflow/legacy-rejection.test.ts test/cli-e2e/openspec-workflow-journeys.test.ts`

Expected: FAIL on default schema or old root routing.

- [ ] **Step 3: 实现并统一诊断**

更新默认常量和 root output；在各 canonical 分支将自然语言错误改为中文，例如“canonical Change 必须使用 `CHG-YYYYMMDD-NNN`；不支持旧 slug 标识”。不修改 JSON 的稳定 key、状态值和 ID。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run test/commands/artifact-workflow.test.ts test/core/openspec-workflow/legacy-rejection.test.ts test/cli-e2e/openspec-workflow-journeys.test.ts`

Expected: PASS，且 legacy rejection、路径安全和 JSON 契约保持有效。

- [ ] **Step 5: Commit**

```bash
git add src/commands/workflow/shared.ts src/commands/workflow/new-change.ts src/commands/workflow/status.ts src/commands/show.ts src/commands/validate.ts src/cli/index.ts test/commands/artifact-workflow.test.ts test/core/openspec-workflow/legacy-rejection.test.ts test/cli-e2e/openspec-workflow-journeys.test.ts
git commit -m "feat: route CLI commands through canonical code-spec"
```

### Task 4: 建立中文用户界面文案与状态显示层

**Files:**
- Create: `src/ui/user-facing-messages.ts`
- Modify: `src/commands/shared-output.ts`
- Modify: `src/core/openspec-workflow/types.ts`
- Modify: `src/core/openspec-workflow/state-machine.ts`
- Modify: `src/core/openspec-workflow/gates.ts`
- Modify: `src/core/openspec-workflow/verification.ts`
- Modify: `src/core/openspec-workflow/archive-transaction.ts`
- Test: `test/core/user-facing-messages.test.ts`
- Test: `test/commands/artifact-workflow.test.ts`

**Interfaces:**
- `formatStatusLabel(status: ChangeStatus): string` 返回 `分析（ANALYZE）`、`设计（DESIGN）`、`计划（PLAN）`、`实现（IMPLEMENT）`、`验证（VERIFY）`、`归档（ARCHIVE）`、`已归档（ARCHIVED）`、`已放弃（ABANDONED）`。
- `formatDiagnosticMessage(code, message)` 只转换人类自然语言，不改 `code`、`target`、`fix` 中的协议命令和路径。
- `emitFailure` 的 human mode 使用中文错误前缀和修复标签；`--json` 保持一个 JSON 文档且可读 message/fix 使用中文。

- [ ] **Step 1: 写失败测试**

```ts
expect(formatStatusLabel('ANALYZE')).toBe('分析（ANALYZE）');
expect(formatStatusLabel('ARCHIVED')).toBe('已归档（ARCHIVED）');
expect(asStatus(new Error('示例'), 'command_error').code).toBe('command_error');
```

为生命周期错误增加 human-mode 断言：状态门禁、STALE、验证证据不足、归档冲突均输出中文句子，同时保留 `ANALYZE`/`ARCHIVE` 等协议值。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run test/core/user-facing-messages.test.ts test/commands/artifact-workflow.test.ts -t "中文|状态|gate|STALE|ARCHIVE"`

Expected: FAIL because current messages are English literals and no shared status formatter exists.

- [ ] **Step 3: 实现文案层并接入命令输出**

集中定义状态标签、错误前缀、修复标签和公共提示；修改 `shared-output.ts`、生命周期模块及其调用方，所有人类输出通过 formatter。协议值只在括号、命令、路径或 JSON 字段中保留。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run test/core/user-facing-messages.test.ts test/commands/artifact-workflow.test.ts`

Expected: PASS，且 JSON stdout 仍能被 `JSON.parse` 解析。

- [ ] **Step 5: Commit**

```bash
git add src/ui/user-facing-messages.ts src/commands/shared-output.ts src/core/openspec-workflow/types.ts src/core/openspec-workflow/state-machine.ts src/core/openspec-workflow/gates.ts src/core/openspec-workflow/verification.ts src/core/openspec-workflow/archive-transaction.ts test/core/user-facing-messages.test.ts test/commands/artifact-workflow.test.ts
git commit -m "feat: localize canonical workflow output to Chinese"
```

### Task 5: 中文化 init、update、帮助、诊断和工具适配输出

**Files:**
- Modify: `src/core/init.ts`
- Modify: `src/core/update.ts`
- Modify: `src/ui/welcome-screen.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/schema.ts`
- Modify: `src/commands/store.ts`
- Modify: `src/commands/workset.ts`
- Modify: `src/core/store/errors.ts`
- Modify: `src/core/project-config.ts`
- Test: `test/core/init.test.ts`
- Test: `test/core/update.test.ts`
- Test: `test/commands/config.test.ts`
- Test: `test/commands/store.test.ts`
- Test: `test/commands/workset.test.ts`

**Interfaces:**
- init 输出使用中文，例如“正在创建 OpenSpec 结构……”“已为 Codex 安装 6 个技能；该工具使用技能，不生成命令文件”。
- 配置、store、workset、schema 和 update 的人类错误包含中文说明和中文 `Fix:`/`修复：` 标签；可复制命令原样保留。
- `--help` 的描述、参数说明和示例改为中文，但命令名、选项名和路径保持英文。

- [ ] **Step 1: 写失败测试**

将现有 init/workset/config/store 人类输出测试增加中文断言，并新增一个命令帮助快照断言：`openspec init --help` 包含中文描述、`--schema <code-spec|spec-driven>` 和英文命令语法。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run test/core/init.test.ts test/core/update.test.ts test/commands/config.test.ts test/commands/store.test.ts test/commands/workset.test.ts test/cli-e2e/basic.test.ts`

Expected: FAIL on current English copy.

- [ ] **Step 3: 翻译并保留协议**

逐文件替换用户自然语言；不翻译 `schema`、`code-spec`、`spec-driven`、命令、选项、稳定 ID、文件名、URL 和外部工具原生语法。修复建议采用“修复：`openspec ...`”格式。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run test/core/init.test.ts test/core/update.test.ts test/commands/config.test.ts test/commands/store.test.ts test/commands/workset.test.ts test/cli-e2e/basic.test.ts`

Expected: PASS；Codex 仍只生成 skills，但提示和帮助内容均为中文。

- [ ] **Step 5: Commit**

```bash
git add src/core/init.ts src/core/update.ts src/ui/welcome-screen.ts src/cli/index.ts src/commands/config.ts src/commands/schema.ts src/commands/store.ts src/commands/workset.ts src/core/store/errors.ts src/core/project-config.ts test/core/init.test.ts test/core/update.test.ts test/commands/config.test.ts test/commands/store.test.ts test/commands/workset.test.ts test/cli-e2e/basic.test.ts
git commit -m "feat: translate OpenSpec CLI user surfaces to Chinese"
```

### Task 6: 中文化生成的 Skill、模板、README 和工作流文档

**Files:**
- Modify: `src/core/templates/**/*.ts`
- Modify: `src/core/templates/workflows/**/*.ts`
- Modify: `src/core/templates/workflows/openspec-workflow.ts`
- Modify: `src/core/templates/workflows/onboard.ts`
- Modify: `src/core/templates/workflows/propose.ts`
- Modify: `src/core/templates/workflows/apply-change.ts`
- Modify: `src/core/templates/workflows/ff-change.ts`
- Modify: `src/core/templates/workflows/update-change.ts`
- Modify: `src/core/templates/workflows/sync.ts`
- Modify: `src/core/templates/workflows/archive.ts`
- Modify: `docs/**/*.md`
- Test: `test/core/templates/skill-content-equivalence.test.ts`
- Test: `test/core/templates/openspec-workflow.test.ts`
- Test: `test/core/templates/skillssh-parity.test.ts`
- Test: `test/vocabulary-sweep.test.ts`

**Interfaces:**
- 生成的自然语言标题、正文、步骤、错误引导和示例说明使用中文。
- Skill 中的 `$openspec-*`、`/opsx:*`、`CHG-*`、`MOD-*`、状态枚举和 DSL Token 保留英文并可直接复制执行。
- 文档中的 canonical 目录结构、配置 YAML key 和协议示例保持原样；解释文字改为中文。

- [ ] **Step 1: 写失败测试**

扩展模板测试，渲染 `openspec-workflow`、propose、apply、archive 和 onboard，断言关键标题包含中文，同时断言 `CHG-YYYYMMDD-NNN`、`MOD-###-REQ-###`、`ANALYZE`、`ADDED` 和命令 token 未被翻译。更新 parity 测试的期望哈希输入。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run test/core/templates/skill-content-equivalence.test.ts test/core/templates/openspec-workflow.test.ts test/core/templates/skillssh-parity.test.ts`

Expected: FAIL on English template content or stale parity hashes.

- [ ] **Step 3: 翻译模板并更新生成物**

按“中文业务正文 + 英文机器协议”逐个修改模板源；依次运行 `pnpm run generate:skills` 和 `pnpm run regen:parity-hashes`，确保生成结果与源模板一致。不要把 `.agents` 中的本地用户文件纳入提交。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run test/core/templates/skill-content-equivalence.test.ts test/core/templates/openspec-workflow.test.ts test/core/templates/skillssh-parity.test.ts test/vocabulary-sweep.test.ts`

Expected: PASS，且不出现协议 token 被误翻译或中文文案漂移。

- [ ] **Step 5: Commit**

```bash
git add src/core/templates docs test/core/templates/skill-content-equivalence.test.ts test/core/templates/openspec-workflow.test.ts test/core/templates/skillssh-parity.test.ts test/vocabulary-sweep.test.ts
git commit -m "docs: provide Chinese OpenSpec workflow guidance"
```

### Task 7: 完成全量回归与发布前验证

**Files:**
- Modify: `test/cli-e2e/basic.test.ts`
- Modify: `test/commands/artifact-workflow.test.ts`
- Modify: `test/core/init.test.ts`
- Modify: `test/core/openspec-root.test.ts`
- Create: `test/fixtures/code-spec-default/openspec/config.yaml`
- Create: `test/fixtures/code-spec-default/openspec/business.md`
- Create: `test/fixtures/code-spec-default/openspec/changes/index.yaml`

**Interfaces:**
- Fixture 必须是可加载的完整 canonical workspace，并包含至少一个 `MOD-001` 模块行。
- 回归测试同时验证默认初始化、自动覆盖、旧文件保留、canonical Change 创建、中文 human output、英文 JSON/protocol 和 Codex skill-only 输出。

- [ ] **Step 1: 添加端到端 fixture 与失败断言**

使用 `runCLI(['init', '--tools', 'none', '--no-animation'])` 初始化空 fixture，再运行 `openspec new change "中文变更" --json`；断言配置 schema、目录、Change ID、输出语言和旧目录隔离结果。

- [ ] **Step 2: 运行定向回归**

Run: `pnpm vitest run test/core/init.test.ts test/core/openspec-root.test.ts test/commands/artifact-workflow.test.ts test/cli-e2e/basic.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行构建、lint、全量测试和差异检查**

```bash
pnpm run build
pnpm run lint
pnpm test
git diff --check
```

Expected: 全部成功；完整测试不得恢复旧 Change 兼容断言。

- [ ] **Step 4: Commit**

```bash
git add test
git commit -m "test: cover code-spec defaults and Chinese UX"
```
