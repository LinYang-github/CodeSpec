# CodeSpec 自定义研发流程封装

> 面向研发人员的 PPT 大纲。每页包含投屏要点、讲解提示和建议视觉。产品事实以当前 `code-spec` 实现为准。

## 1. 封面：CodeSpec 与 Superpowers

**投屏要点**

- 主题：用 CodeSpec 管理研发对象，用 Superpowers 承担工程方法。
- 目标：让研发人员只面对少量稳定入口，而不是记忆一组阶段命令。
- 结论：CodeSpec 管对象，Superpowers 管方法，自定义 Workflow 管流程。

**讲解提示**

这不是重新发明一套研发框架。CodeSpec 提供 Change、Artifact、Spec、Archive 和生命周期治理，再把入口和工程方法重新分工。

**建议视觉**

`研发请求 → Workflow → CodeSpec Core + Superpowers → 代码与可追溯记录`

---

## 2. 先看问题：研发流程为什么会变得难用

**投屏要点**

- 一个 Change 有创建、继续、实现、更新、验证、同步、归档等阶段动作。
- 阶段动作直接成为入口时，研发人员必须判断下一步该调用什么。
- 规则分散在不同提示中，Change、Baseline、Requirement、归档边界容易出现不一致。
- 若再叠加通用工程 Skill，分析、计划、调试和验证会出现重复入口。

**讲解提示**

问题不在于能力不够，而在于用户可见的选择太多。研发人员本应表达“我要完成这项变更”，不应先判断自己处于哪个内部阶段。

**建议视觉**

多个并列箭头：`new / continue / apply / verify / sync / archive`，箭头最终都指向“研发人员需要自行判断”。

---

## 3. 为什么选择 CodeSpec 作为流程骨架

**投屏要点**

| CodeSpec 对象 | 在 CodeSpec 中的作用 |
| --- | --- |
| **Change** | 一次可识别、可追踪的研发变更，使用 `CHG-YYYYMMDD-NNN`。 |
| **Artifact** | 把每个阶段的结论留成文件，而不是只留在对话上下文。 |
| **Requirement / Scenario** | 把行为、异常处理和验证对象变成可检查的契约。 |
| **Baseline** | 记录 Change 开始时依赖的规格版本，用于发现漂移。 |
| **Archive** | 以事务方式更新 Current Specification，并保留决策历史。 |

**讲解提示**

CodeSpec 的价值是把研发对象落到稳定结构中。它并不替研发人员决定设计方案或如何调试，而是让这些工程活动有明确的输入、输出和可追溯关系。

**建议视觉**

`需求 → Change → Artifacts → Code / Evidence → Archive → Current Specification`

---

## 4. 改造边界：保留什么，调整什么

**投屏要点**

```text
保持稳定：CodeSpec Core
  Change / Requirement / Baseline / 状态机 / 校验 / 归档事务

重点调整：执行层
  公开 Skill / Workflow 编排 / 模板 / Gate / 上下文注入
```

- Core 仍是路径、ID、状态、验证和事务规则的唯一来源。
- Skill 只负责理解请求、组织上下文、路由能力。
- 通用工程方法不在 CodeSpec 中重复实现。

**讲解提示**

这条边界是后续所有设计决策的依据。只要某项能力会改变 Current Specification、Change 状态或 Baseline，它就必须回到 Core，而不是交给提示词自由处理。

---

## 5. 第一阶段：7 个核心阶段入口

**投屏要点**

本页的“7”是按职责划分的原始核心研发阶段，不把它表述为某个历史版本唯一存在的生成集合。

| 核心入口 | 原本解决的问题 |
| --- | --- |
| `new-change` | 创建 Change 和第一个 Artifact。 |
| `continue-change` | 继续 Change，并生成下一个 Artifact。 |
| `apply-change` | 按任务实施代码变更。 |
| `update-change` | 修订已存在的规划产物。 |
| `sync-specs` | 将 Delta 写回主 Spec。 |
| `verify-change` | 在归档前检查实现与产物是否一致。 |
| `archive-change` | 归档完成的 Change。 |

**讲解提示**

这七项覆盖了完整研发动作，但它们把内部生命周期直接暴露给使用者。新成员需要先学习流程分支，才能开始一次开发。

---

## 6. 第二阶段：为什么入口扩展为 13 个

**投屏要点**

13 个历史公开入口由“7 个核心阶段”加“6 个快捷、辅助和引导入口”组成：

| 新增入口 | 产生原因 | 带来的代价 |
| --- | --- | --- |
| `workflow` | 提供统一工作流适配。 | 与阶段入口并存。 |
| `explore` | 提供需求探索。 | 与工程分析方法重叠。 |
| `ff-change` | 快速生成规划产物。 | 容易弱化逐步确认。 |
| `bulk-archive-change` | 支持批量归档。 | 扩大归档边界和误操作面。 |
| `onboard` | 引导新成员。 | 属于教学，不是日常开发入口。 |
| `propose` | 一次性创建完整规划。 | 与创建、继续、快速生成重叠。 |

**讲解提示**

13 个入口不是功能错误，而是阶段能力、效率工具和教学工具长期叠加的结果。问题是它们都出现在同一个用户可见层。

---

## 7. 第三阶段：13 个入口如何收敛为 3 个

**投屏要点**

| 历史入口 | 现在的处理方式 | 当前能力承载方 |
| --- | --- | --- |
| `workflow` | 保留为正常开发唯一入口。 | `codespec-workflow` |
| `new-change` | 合并。 | Core `createChange()` + Workflow |
| `continue-change` | 合并。 | Core `resolveChange()`、`status` + Workflow |
| `apply-change` | 合并。 | Workflow + Superpowers TDD |
| `update-change` | 合并。 | Workflow + brainstorming / writing-plans |
| `propose` | 合并。 | Workflow 创建 Change 后生成规划产物 |
| `ff-change` | 不再提供跳过式入口。 | Workflow 按 Gate 推进 |
| `explore` | 能力迁移。 | Superpowers `brainstorming` |
| `verify-change` | 能力迁移并受 Core 门禁约束。 | Superpowers verification + Core |
| `sync-specs` | 收回为内部能力。 | Core archive transaction |
| `bulk-archive-change` | 不再作为并列入口。 | 单 Change 人工确认归档 |
| `onboard` | 移出日常研发入口。 | 文档和培训材料 |
| `archive-change` | 保留为唯一提交入口。 | `codespec-archive-change` |

**讲解提示**

收敛不是减少能力。它把“需要用户选择的入口”减少为三个，把确定性规则收回 Core，把通用工程方法交给已经成熟的 Superpowers。

---

## 8. 最终保留的 3 个公开 Skill

**投屏要点**

| Skill | 何时使用 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| `codespec-workflow` | 所有正常开发请求。 | 创建或解析 Change，注入上下文，编排分析、计划、实现和验证。 | 不直接写 Current Specification。 |
| `codespec-rebase-change` | Core 报告 `STALE`、Baseline 漂移或多 Change 冲突。 | 重建 Baseline，恢复到可开发状态。 | 不实现代码，不验证，不归档。 |
| `codespec-archive-change` | 实现和验证完成后。 | 执行归档预检，要求人工确认，提交事务。 | 不绕过人工确认，不直接编辑归档目录。 |

**讲解提示**

三个入口对应三种用户意图：正常开发、异常恢复、最终提交。用户不需要理解 `createChange()`、`applyDelta()` 或 `detectStale()` 这些内部函数。

---

## 9. 为什么引入 Superpowers

**投屏要点**

| 工程阶段 | Superpowers 方法 | 与 CodeSpec 的连接 |
| --- | --- | --- |
| 需求不清或新功能 | `brainstorming` | 输出已确认的目标、范围与边界，供 proposal/design/spec 使用。 |
| 多步实施 | `writing-plans` | 形成详细实施计划，`tasks.md` 仅保留 `SP-##` 追踪投影。 |
| 实现 | `test-driven-development` | 用 RED → GREEN → REFACTOR 落实 Requirement 和 Scenario。 |
| 失败排查 | `systematic-debugging` | 先定位根因；需求变化时回到分析或计划。 |
| 完成前检查 | `verification-before-completion` | 记录 Requirement、测试、构建和 lint 的新鲜证据。 |
| 需要协作审查时 | `requesting-code-review` / `receiving-code-review` | 审查代码，不替代 Core 的状态和归档门禁。 |

**讲解提示**

CodeSpec 不再实现第二套“如何设计、如何写测试、如何调试”的提示词。它把准确的 Change、Requirement、Scenario、Task 和 Baseline 上下文交给 Superpowers，让工程方法在正确的上下文中执行。

---

## 10. 为什么复用而不是自建工程 Skill

**投屏要点**

| 自建一套工程 Skill | 复用 Superpowers |
| --- | --- |
| 与现有工程方法重复。 | 直接复用已有分析、计划、TDD、调试和验证方法。 |
| 需要持续维护 Prompt、边界和升级。 | CodeSpec 只维护领域数据和流程契约。 |
| 模型面对更多近似入口。 | 方法入口由 Workflow 按阶段注入。 |
| 容易把业务状态规则混入工程方法。 | Core 规则与工程方法各自独立演进。 |

**讲解提示**

职责划分的重点不是工具数量，而是单一事实来源。Core 是领域规则的事实来源，Superpowers 是工程方法的事实来源。

---

## 11. 三层架构：对象、方法与流程

**投屏要点**

```text
                    自定义 Workflow
          上下文解析 / 路由 / Gate / Artifact 编排
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
         CodeSpec Core                    Superpowers
 Change / Requirement / Baseline      分析 / 计划 / TDD
 Artifact / 状态机 / Archive          调试 / 验证 / 审查
               │                             │
               └──────────────┬──────────────┘
                              ▼
                      Project / Code / Evidence
```

**讲解提示**

CodeSpec 管“这次研发改变什么”。Superpowers 管“如何把它做好”。Workflow 管“现在处于什么阶段、该调用什么能力、什么证据才能进入下一阶段”。

---

## 12. Workflow 如何编排，而不是让人记命令

**投屏要点**

```text
研发意图
  ↓
解析 context + status，确定唯一 Change
  ↓
Core 检查模块、Requirement、Baseline、状态和冲突
  ├─ STALE / 冲突 → codespec-rebase-change → 回到 Workflow
  └─ 正常 → 按 Change mode 调用 Superpowers
                   ↓
        Artifact / Code / Verification evidence
                   ↓
        Core Gate 判断下一步或进入 Archive
```

- `feature`：brainstorming → writing-plans → TDD。
- `bugfix`：systematic-debugging → 评估 Spec 影响 → TDD。
- `refactor`：设计影响分析 → writing-plans → TDD。
- 每次实质动作后刷新 `status`，并回写追踪关系和证据。

**讲解提示**

研发人员的主要操作是表达任务或继续当前 Change。Workflow 根据 Core 返回的事实做路由；上下文不明确时停止，而不是猜测一个 Change。

---

## 13. 一个 Change 的完整生命周期

**投屏要点**

| 阶段 | 输入 | 执行动作 | 输出 | 完成条件 | 主责 |
| --- | --- | --- | --- | --- | --- |
| `ANALYZE` | 用户意图、现有代码、Spec。 | 解析或创建 `CHG-*`，明确模块和范围。 | `metadata.yaml`、`proposal.md`。 | Change 唯一，目标和范围明确。 | Workflow + Core + brainstorming |
| `DESIGN` | Proposal、现有约束。 | 设计方案和行为契约。 | `design.md`、`spec.md`。 | Requirement、Scenario、`ERROR` 处理已明确。 | Superpowers + Core 校验 |
| `PLAN` | Design、Spec。 | 形成实施计划和可追踪任务。 | `tasks.md`（`SP-##` 投影）。 | 任务可执行并关联 Requirement。 | writing-plans + Workflow |
| `IMPLEMENT` | Tasks、代码库。 | TDD 实现与调试。 | Code、测试、任务进度。 | 任务完成，范围不扩张。 | Superpowers |
| `VERIFY` | Code、Requirement、Scenario。 | 运行测试、构建、lint，记录证据。 | `verification.md`。 | 所需证据新鲜且通过。 | verification + Core Gate |
| `ARCHIVE` | 完成的 Change、验证证据。 | 预检、人工确认、事务提交。 | Current Specification、归档历史。 | 无 `STALE`、无冲突、可追溯。 | Core + 人工确认 |

**讲解提示**

`VERIFY` 可以因证据不足退回 `IMPLEMENT` 或 `DESIGN`。任何阶段遇到 Baseline 漂移，都先走 rebase，而不是带着旧结论继续开发。

---

## 14. Artifact 如何流转

**投屏要点**

```text
用户请求
  ↓
metadata.yaml ─── 状态、Baseline、Requirement、Task、验证门禁的权威记录
  ↓
proposal.md  ─── 为什么改、影响什么
  ↓
design.md + spec.md ─── 技术决策 + Requirement / Scenario / ERROR 契约
  ↓
tasks.md ─── SP-## 实施追踪投影
  ↓
Code + tests + verification.md ─── 实现结果与新鲜证据
  ↓
archive transaction
  ├─ codespec/specs/<MODULE>/spec.md     Current Specification
  └─ codespec/archive/changes/<CHG-ID>/          不可变 Change 历史
```

**讲解提示**

`metadata.yaml` 是状态权威，`verification.md` 不是口头结论而是可复查证据。只有归档事务可以把 Delta 应用到 Current Specification；Skill 不能绕过该边界直接写主 Spec。

---

## 15. 真实案例：用户详情弹窗

**投屏要点**

**Change**：`CHG-20260903-001`，在用户管理列表中新增只读用户详情弹窗。

| 阶段 | 本案例发生了什么 | 留下的证据 |
| --- | --- | --- |
| 用户输入 | 管理员需要在不离开用户列表的情况下查看一条用户的基础详情。 | `proposal.md` 的 Why、Goals 和 Scope。 |
| Workflow / Core | 创建唯一 `CHG-20260903-001`，确认 `MOD-001`，分配 `MOD-001-REQ-001`。 | `metadata.yaml` 的 Change、module、Requirement 和 Gate。 |
| 分析与设计 | 选择复用列表数据、现有格式化和 i18n；不新增 API、路由或数据写入。 | `design.md` 的决策和非目标。 |
| 计划与实施 | 用三个 `SP-##` 跟踪详情入口、空值/i18n 集成和 fresh verification。 | `tasks.md` 与 metadata 任务状态。 |
| 验证 | 覆盖 `SCN-001` 打开弹窗、`SCN-002` 关闭弹窗，并记录 e2e、单元测试、build、lint。 | `verification.md`，所有 Exit status 为 `0`。 |
| 人工归档 | 所有 Gate 满足后归档。 | `archive/changes/CHG-20260903-001/` 与 `archive/history.yaml`。 |
| Current Spec | 用户详情行为成为 `MOD-001` 的正式契约。 | `archive/specs/MOD-001/spec.md`。 |

**讲解提示**

这是 Aegis Auth Web 项目中的真实 canonical `code-spec` Change。它展示了需求如何从一个界面诉求，变成一个有 Module、Requirement、Scenario、Task、验证证据和归档记录的可追溯变更。

**现场展示顺序**

1. 展示 `proposal.md` 的 Scope，强调“不新增 API、不修改用户数据”。
2. 展示 `design.md` 的“复用列表数据”决策。
3. 展示 `tasks.md` 中 Requirement 与 `SCN-001`、`SCN-002` 的关联。
4. 展示 `verification.md` 的 test、build、lint 记录。
5. 最后对照 `archive/specs/MOD-001/spec.md`，说明归档后哪些行为成为 Current Specification。

---

## 16. 改造前后：研发人员实际感受到什么

**投屏要点**

| 维度 | 7 → 13 的阶段入口模式 | 3 个公开入口的 CodeSpec 模式 |
| --- | --- | --- |
| 研发起点 | 先判断该用哪个阶段或快捷入口。 | 正常请求统一从 `codespec-workflow` 开始。 |
| 工程方法 | CodeSpec 提示与工程方法容易交叠。 | Workflow 在合适阶段调用 Superpowers。 |
| Change 规则 | 容易散落在多个入口的指令中。 | Core 统一管理 ID、Baseline、状态和 Traceability。 |
| `STALE` | 可能与正常开发动作混在一起。 | 只转入 `codespec-rebase-change`，完成后回到 Workflow。 |
| 主 Spec 更新 | 曾存在独立 sync 的理解路径。 | 只能经 `codespec-archive-change` 的事务提交。 |
| 归档 | 容易被视为普通收尾步骤。 | 人工确认、验证证据、冲突检查都是 Gate。 |

**讲解提示**

改造后的变化不是“少了十个功能”，而是研发人员少了十种需要自行判断的入口。过程仍保留，但由 Workflow、Core 和 Superpowers 在各自边界内承担。

---

## 17. 收束：形成可维护的研发流程体系

**投屏要点**

- **可维护**：领域规则集中在 Core，工程方法复用 Superpowers。
- **可扩展**：增加新工程方法时，不必增加新的 Change 入口。
- **可审计**：Artifact、Baseline、验证证据和归档历史都可回查。
- **可恢复**：Baseline 漂移通过 rebase 回到可开发状态。
- **可控**：Current Specification 只由人工确认后的归档事务更新。

**结束语**

研发人员只需从 `codespec-workflow` 开始。系统在正确阶段使用正确的方法，并把每次 Change 留为可以复查、恢复和演进的记录。

## 讲稿事实索引

- 公开 Skill 生成集合：`src/core/shared/skill-generation.ts`。
- 三个 Skill 的运行指令：`src/core/templates/workflows/codespec-workflow.ts`、`rebase-change.ts`、`archive-change.ts`。
- canonical 路径与 Artifact 顺序：`codespec/config.yaml`、`schemas/code-spec/schema.yaml`。
- 生命周期、Core 与 Superpowers 边界：`docs/workflows.md`。
- 三 Skill 收敛回归：`test/core/templates/codespec-workflow.test.ts`。
- canonical 运行时旅程和归档人工确认：`test/cli-e2e/codespec-workflow-journeys.test.ts`。
- 真实业务案例：`/Users/wanglinan/Documents/01_工作/02_AI/01_project/aegis-auth/web/codespec/archive/changes/CHG-20260903-001/`。
