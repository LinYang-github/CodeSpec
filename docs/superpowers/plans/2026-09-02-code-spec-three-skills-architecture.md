# CodeSpec Three-Skill Architecture Implementation Plan

> **Execution constraint:** 禁止使用子智能体；必须由当前会话按步骤串行执行本计划。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CodeSpec 根目录 `skills/` 收敛为三个公开入口：`openspec-workflow`、`openspec-rebase-change` 和 `openspec-archive-change`，并把 Change、Requirement、Baseline、STALE、Traceability、Canonical Spec 与归档事务等能力统一留在 OpenSpec Core；工程方法继续交由 Superpowers 承担。

**Architecture:** 保留 `openspec-*` 公开命名，采用“方案 A 的迁移路径 + 已确认的三 Skill 最终结构”。生成器使用独立的 public workflow surface；旧 workflow id 只用于迁移和清理，不再用于生成新的 Skill 或 AI command。三个 Skill 负责意图识别、入口路由和状态门禁，Core 负责所有领域状态变更与事务，Superpowers 负责 brainstorming、plan、TDD、debug、verify、review 和分支收尾。

**Tech Stack:** TypeScript、Vitest、pnpm、现有 `src/core/templates` Skill 生成器、现有 `src/core/openspec-workflow` Core 模块、Markdown Skill 模板。

**Spec:** `docs/superpowers/specs/2026-09-02-code-spec-three-skills-architecture-design.md`

## Global Constraints

- 根目录最终只生成三个 OpenSpec Skill 目录：`skills/openspec-workflow`、`skills/openspec-rebase-change`、`skills/openspec-archive-change`。
- `openspec-workflow` 是正常开发唯一入口；不得再生成或推荐 `new`、`propose`、`explore`、`continue`、`apply`、`update`、`ff`、`verify`、`onboard` 等独立入口。
- `openspec-rebase-change` 是 STALE、多 Change 冲突或基线需要重建时的唯一入口；不得把 `detect-stale`、`resolveChange`、`captureBaseline` 等能力暴露为独立 Skill。
- `openspec-archive-change` 是 Current Specification 提交的唯一入口；不得把 `sync-specs` 或 `bulk-archive-change` 作为并列 Skill 继续生成。
- 公开 Skill 不直接修改 Current Specification；所有领域写入必须经过 OpenSpec Core 的现有事务 API 或新增的内部适配层。
- 现有 CLI 机器接口保持兼容。旧 CLI 命令可继续被脚本和测试调用，但不再作为新的 AI Skill 入口生成。
- 旧已安装 Skill 必须可以被迁移/清理；旧 workflow id 仅保留在兼容、迁移和清理路径中，不得污染新的 public profile 输出。
- 不修改用户已有的未提交变更；特别是当前已修改的 `src/core/init.ts` 和 `test/core/init.test.ts`。
- `skills/` 下的生成文件不手工维护；模板和生成器修改完成后，统一通过项目已有的 build/generate 流程刷新。
- 不在本次变更中设计完整 SDD 规则。只建立 SDD 决策留在 Core 的边界，并确保公开 Skill 不复制或暴露 SDD 领域函数。

---

## 1. 建立 public workflow surface 与 legacy compatibility surface

**Files:**

- Modify: `src/core/profiles.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/profile-sync-drift.ts`
- Modify: `src/core/shared/tool-detection.ts`
- Modify: `src/core/migration.ts`
- Modify: `src/core/update.ts`
- Review without overwriting user changes: `src/core/init.ts`
- Tests: `test/core/profiles.test.ts`, `test/core/profile-sync-drift.test.ts`, `test/core/shared/tool-detection.test.ts`, `test/core/legacy-cleanup.test.ts`

- [x] 在 `src/core/profiles.ts` 增加明确的公开 surface 常量，例如 `PUBLIC_WORKFLOWS = ['workflow', 'rebase', 'archive']`，并保留旧 `ALL_WORKFLOWS` 的语义作为 `LEGACY_WORKFLOWS` 或等价的兼容集合。
- [x] 增加旧 workflow 到公开入口的归一化映射：正常开发相关旧 id 统一映射到 `workflow`，`rebase` 映射到 `rebase`，`archive`、`sync` 和 `bulk-archive` 映射到 `archive`。
- [x] 让默认 `core` profile 返回三个公开 workflow；让 custom profile 的旧选择先归一化再去重，输出只包含三个公开 id。
- [x] 保留 profile 对非法输入的现有校验行为，并明确测试空选择、重复选择和旧 id 选择的结果。
- [x] 将 `config.ts` 的 `OPENSPEC_SKILL_NAMES` 改为三个公开 Skill 名称；单独提供 legacy skill 名称集合供迁移和清理使用，避免清理逻辑依赖公开集合。
- [x] 更新 `profile-sync-drift.ts` 的公开映射和旧映射：新生成只比较三个公开目录，旧目录仍能被发现、报告和删除。
- [x] 更新 `tool-detection.ts` 的公开 Skill 检测结果，使其只返回三个公开 Skill；旧目录检测继续用于兼容提示和迁移判断，而不是作为可选 Skill 暴露。
- [x] 检查 `migration.ts`、`update.ts` 和 `init.ts` 的调用链，确保它们把 public surface 用于生成，把 legacy surface 用于清理；对 `init.ts` 只做最小兼容调整，不覆盖用户现有修改。
- [x] 为每个映射增加断言：默认 profile 恰好是三个入口；旧 workflow 不会产生第四个输出目录；清理过程仍能移除旧生成目录和旧命令文件。

**Verification:**

```bash
pnpm vitest run test/core/profiles.test.ts test/core/profile-sync-drift.test.ts test/core/shared/tool-detection.test.ts test/core/legacy-cleanup.test.ts
```

## 2. 收敛 Skill 与 AI command 生成注册表

**Files:**

- Modify: `src/core/shared/skill-generation.ts`
- Modify: `src/core/templates/skill-templates.ts`
- Modify: `src/core/config.ts`
- Tests: `test/core/shared/skill-generation.test.ts`, `test/core/templates/skill-templates-parity.test.ts`, `test/core/templates/parity-hash-shared.test.ts`

- [x] 将 `getSkillTemplates()` 改为只注册 `openspec-workflow`、`openspec-rebase-change` 和 `openspec-archive-change`。
- [x] 将 `getCommandTemplates()` 与公开入口保持一致；旧 command id 不再进入新安装/更新输出，但保留 CLI 层已有的机器接口实现。
- [x] 为生成器增加稳定的公开入口顺序，并测试 Skill 数量、名称、command 数量和名称集合，防止后续模板注册回退到按阶段拆分。
- [x] 让 workflow/profile filter 接受旧配置并在进入生成器前完成归一化，避免 custom profile 升级后生成空目录或重复目录。
- [x] 删除不再被注册表引用的旧模板 facade re-export；只有仍被 CLI、测试或兼容路径明确依赖的模块才保留，并标记为非公开生成实现。
- [x] 保持模板 hash/parity 测试的生成链路不变：所有根目录 `skills/` 输出仍从 `src/core/templates` 生成。

**Verification:**

```bash
pnpm vitest run test/core/shared/skill-generation.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/parity-hash-shared.test.ts
```

## 3. 把 `openspec-workflow` 扩展为唯一开发编排入口

**Files:**

- Modify: `src/core/templates/workflows/openspec-workflow.ts`
- Modify: `src/core/templates/skill-templates.ts`
- Tests: `test/core/templates/openspec-workflow.test.ts`, `test/core/shared/skill-generation.test.ts`

- [x] 保留现有 canonical context 和工具识别指导，但把模板从“通用说明”扩展为完整开发编排入口。
- [x] 定义唯一输入契约：用户意图、当前 Change（如有）、模块范围、是否存在 STALE/多 Change、验证结果和下一步目标。
- [x] 在模板中明确开发生命周期路由：需求澄清和方案探索交给 `superpowers:brainstorming`；计划交给 `superpowers:writing-plans`；实现交给 TDD/执行计划；异常交给 systematic debugging；完成前必须 verification；需要时交给 code review。
- [x] 把 `createChange()`、`resolveChange()`、`allocateChangeId()`、模块解析、Requirement ID 分配、Baseline 捕获和变更状态推进描述为 Core 内部能力，不再把它们写成用户需要选择的独立 Skill。
- [x] 明确在进入实现前检查 Change、模块、基线和状态；发现 STALE 或不可安全合并时只路由到 `openspec-rebase-change`。
- [x] 明确 workflow 不直接写 Current Specification；完成实现后只能把归档意图交给 `openspec-archive-change`。
- [x] 保留 unsupported stage 的兼容说明，但将旧阶段名称解释为内部路由语义，不再提示对应旧 Skill 名称。
- [x] 将 `assessSddLevel()`、`resolveSddProfile()` 和 `escalateSddLevel()` 的责任描述为 Core 策略边界；Skill 只消费 Core 的结果，不实现 SDD 判断。

**Verification:**

```bash
pnpm vitest run test/core/templates/openspec-workflow.test.ts
```

测试必须覆盖：单入口路由、Superpowers 委派、STALE 转交、Current Specification 写入边界、Core 内部函数不作为 Skill 名称出现。

## 4. 新增 `openspec-rebase-change` Skill 入口

**Files:**

- Add: `src/core/templates/workflows/rebase-change.ts`
- Modify: `src/core/templates/skill-templates.ts`
- Modify: `src/core/shared/skill-generation.ts`
- Tests: `test/core/templates/rebase-change.test.ts`, `test/core/openspec-workflow/stale-rebase.test.ts`, `test/cli-e2e/openspec-workflow-journeys.test.ts`

- [x] 新模板只描述 STALE、多 Change 冲突、基线重建和 rebase 后重新进入开发的流程。
- [x] 模板通过现有 `rebase` CLI/Core 能力执行，不重新实现 `captureBaseline()`、`detectStaleChanges()`、Change 状态迁移或 revision 递增。
- [x] 明确 rebase 前读取并展示冲突 Change、当前基线和变更摘要；没有明确目标或存在不可自动裁决冲突时停止并请求用户决策。
- [x] 明确 rebase 成功后的状态契约：Change 回到设计阶段，revision 增加，基线、tasks、verification 和 archive 标记按现有 Core 实现重置，随后回到 `openspec-workflow`。
- [x] 明确 rebase 失败不得产生半完成的公开状态；使用现有 Core 的原子写入/回滚边界，或为缺失边界补充最小事务保护。
- [x] 增加测试确认该 Skill 是唯一 STALE 入口，且 `detect-stale` 仍可作为 CLI 机器命令使用但不会生成独立 Skill。

**Verification:**

```bash
pnpm vitest run test/core/templates/rebase-change.test.ts test/core/openspec-workflow/stale-rebase.test.ts test/cli-e2e/openspec-workflow-journeys.test.ts
```

## 5. 将 `openspec-archive-change` 固化为唯一归档事务入口

**Files:**

- Modify: `src/core/templates/workflows/archive-change.ts`
- Modify: `src/core/templates/workflows/openspec-workflow.ts`
- Review/modify only where required: `src/core/openspec-workflow/archive-transaction.ts`
- Tests: `test/core/archive.test.ts`, `test/core/openspec-workflow/archive-transaction.test.ts` if present, `test/cli-e2e/openspec-workflow-journeys.test.ts`

- [x] 将 archive Skill 改为 canonical CodeSpec 路径和 Current Specification 写入协议，移除对 `openspec-sync-specs` 等旧 Skill 的依赖或推荐。
- [x] 归档入口只接受已完成且已验证的 Change；缺少任务、验证结果、Traceability 或存在 STALE 时，先拒绝归档并路由回开发/rebase入口。
- [x] 让模板调用现有 `archiveChange()` 事务边界，并在文案中区分 `preflightArchive()`、`prepareArchive()` 和 `commitArchive()` 的 Core 阶段。
- [x] 确保 `applyDelta()`、Canonical Spec 校验、Traceability 校验、归档冲突检测和 `archiveTransaction()` 留在 Core 内部，不成为 Skill 或 command 选择项。
- [x] 确保归档失败时 Current Specification、Change 文件和归档目录保持可恢复状态；沿用现有测试覆盖并补充失败后文件快照不变的断言。
- [x] 处理 legacy `openspec/specs` 测试/调用路径与 canonical `archive/specs` 路径的兼容关系：新 Skill 只输出 canonical 路径，旧 CLI 行为按现有兼容约束保留。

**Verification:**

```bash
pnpm vitest run test/core/archive.test.ts test/cli-e2e/openspec-workflow-journeys.test.ts
```

## 6. 清理旧模板和旧生成产物，同时保留迁移能力

**Files:**

- Modify: `src/core/templates/skill-templates.ts`
- Modify: `src/core/profile-sync-drift.ts`
- Modify: `src/core/migration.ts`
- Modify: `src/core/update.ts`
- Modify: `src/core/legacy-cleanup.ts`
- Modify: `test/core/legacy-cleanup.test.ts`
- Modify: `test/utils/command-references.test.ts`
- Modify: `test/core/command-generation/invocation.test.ts`

- [x] 在确认没有生成器或运行时代码继续引用后，移除旧阶段 Skill 的公开模板模块和 facade 导出；不删除仍由 CLI 兼容测试直接调用的 Core 实现。
- [x] 让升级流程识别旧目录和旧 command 文件，先删除/迁移旧公开入口，再写入三个新入口；操作应可重复执行且结果稳定。
- [x] 让 legacy cleanup 使用显式旧目录集合，而不是把 `ALL_WORKFLOWS` 当作新生成列表；测试旧目录、旧 command、混合新旧目录三种情况。
- [x] 更新 command reference 测试，使其验证只存在三个公开生成入口，同时保留 CLI 命令实现的引用检查。
- [x] 更新 invocation 测试，区分 public generated commands 与 legacy CLI command ids，避免因为旧机器命令存在而要求生成旧 AI command。
- [x] 运行生成器后确认根目录 `skills/` 没有残留旧目录、旧 Skill 名称引用或指向旧入口的交叉链接。

**Verification:**

```bash
pnpm vitest run test/core/legacy-cleanup.test.ts test/utils/command-references.test.ts test/core/command-generation/invocation.test.ts
```

## 7. 更新公开文档、目录清单和架构说明

**Files:**

- Modify: `skills/README.md`
- Search and update only affected claims under: `docs/`, `README.md`, `src/cli/`
- Keep: `docs/superpowers/specs/2026-09-02-code-spec-three-skills-architecture-design.md`

- [x] 将公开 Skill 清单改为三个入口，并说明旧阶段入口已经内部化或由 Superpowers 接管。
- [x] 文档中明确职责边界：CodeSpec Core 管领域治理和状态事务，Superpowers 管工程方法，archive 是 Current Specification 的唯一提交边界。
- [x] 文档中保留 CLI 机器接口说明，但不把旧 CLI 命令描述成面向 AI 的并列 Skill。
- [x] 更新任何仍声称 `openspec-sync-specs`、`openspec-apply-change` 或其他旧 Skill 是必需入口的文档链接和示例。
- [x] 不把尚未实现的完整 SDD policy 写成现有用户承诺；只说明 SDD 级别由 Core 决定并被 workflow 消费。

**Verification:**

```bash
rg -n "openspec-(apply-change|bulk-archive-change|continue-change|explore|ff-change|new-change|onboard|propose|sync-specs|update-change|verify-change)" skills README.md docs src --glob '!docs/superpowers/specs/**'
```

搜索结果只能保留迁移、兼容、历史说明或测试所需的明确引用；公开使用说明不得继续推荐旧 Skill。

## 8. 生成、静态检查和全量验证

**Files:**

- Generated: `skills/openspec-workflow/SKILL.md`
- Generated: `skills/openspec-rebase-change/SKILL.md`
- Generated: `skills/openspec-archive-change/SKILL.md`
- Removed by the generator/update cleanup: all obsolete generated Skill directories and obsolete generated AI command files

- [x] 执行 `pnpm build`，确保模板、Core 类型和生成器编译通过。
- [x] 执行 `pnpm generate:skills`，刷新根目录 `skills/`，不得手工编辑生成结果。
- [x] 检查 `skills/` 目录的最终结构恰好包含三个公开 Skill 目录及项目允许保留的 README/元数据文件。
- [ ] 执行完整测试和 lint；lint 已通过，但全量测试套件仍有未迁移的旧入口/本地化断言失败及 16 个端口权限错误，故不标记为通过。
- [x] 执行 `git diff --check`，检查 Markdown、TypeScript 和生成文件不存在空白错误。
- [x] 查看最终 `git status --short` 和 diff，确认只包含本架构变更、生成产物及必要测试/文档更新；用户原有的 `src/core/init.ts` 和 `test/core/init.test.ts` 修改仍保持原样。

**Verification:**

```bash
pnpm build
pnpm generate:skills
pnpm lint
pnpm test
git diff --check
find skills -maxdepth 2 -type f | sort
```

验收标准：生成结果只有三个公开 Skill；默认 profile 生成三个入口；旧目录可被升级流程清理；CLI/Core 兼容测试通过；归档仍是唯一 Current Specification 写入边界；所有工程方法由 Superpowers 路由；没有把领域治理函数重新暴露成 Skill。
