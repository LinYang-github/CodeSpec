# CodeSpec 面向编程使用者的工作流图设计

> Status: design confirmed in chat; implementation pending.

## 1. 目标

制作一张适合团队或客户投屏讲解的 CodeSpec 工作流图。观众假设是会写代码、但第一次接触 CodeSpec 的使用者；图需要让观众先回答“我从哪里开始、每一步做什么”，再理解“CodeSpec 与通用 `spec-driven` / open-driven 工作方式有什么区别”，最后知道每个产物保存在哪里、何时产生、谁负责维护。

成品以宽版 SVG 为主，同时导出适合分享的 PNG。图中文字使用中文，命令名、路径、Skill 名、ID、状态和 schema token 保持英文。

## 2. 叙事主线

图从左到右、从上到下按以下顺序阅读：

```text
编程使用者描述需求
        ↓
openspec-workflow：唯一正常开发入口
        ↓
生成并迭代一个 Change
        ↓
实现与验证
        ↓
openspec-archive-change：确认后归档
```

主线旁边单独放出异常分支：出现 `STALE`、Baseline 漂移或多 Change 冲突时，进入 `openspec-rebase-change`，完成 semantic rebase 后返回 `workflow`；它不是第二条正常开发路径。

## 3. 画面结构

采用三段式宽版布局：

1. **上段：从 0 开始怎么用**
   - 先展示安装 / 初始化的最小入口：`openspec init`。
   - 展示用户在 AI 对话中输入 `/opsx:workflow <what-you-want-to-build>`。
   - 用 4 个编号步骤讲清楚：描述需求、形成 Change、编码验证、人工确认归档。
   - 用橙色虚线标出 `STALE / 冲突 → rebase → workflow`。

2. **中段：为什么只保留三个 Skills**
   - 用三张职责卡展示：
     - `openspec-workflow`：正常开发，承载分析、规划、实现、验证的完整协作线。
     - `openspec-rebase-change`：只处理基线过期和冲突恢复。
     - `openspec-archive-change`：只处理 Current Specification 的事务性更新和 Change 归档。
   - 在卡片下方用一行边界说明：OpenSpec Core 负责领域治理和事务；Superpowers 负责 brainstorming、planning、TDD、debugging、verification、review。
   - 解释收敛原因：用户不再需要在 `new / propose / continue / apply / verify / sync` 等阶段入口之间做选择；能力仍存在，但变成 `workflow` 内部编排或 Core 能力。

3. **下段：一次 Change 产生什么**
   - 以 `openspec/changes/CHG-YYYYMMDD-NNN/` 为中心展示产物树。
   - 逐项写出文件用途：
     - `metadata.yaml`：状态权威、Change、Baseline、Requirement、Task、验证和归档门禁。
     - `proposal.md`：为什么改、改什么、影响范围。
     - `design.md`：怎么实现、边界和技术决策。
     - `spec.md`：Requirement 与 Scenario；Scenario 使用 `GIVEN / WHEN / THEN / ERROR`。
     - `tasks.md`：`SP-##` 的简洁任务投影。
     - `verification.md`：测试、构建、lint、Baseline 和 fresh verification 证据。
   - 用箭头指向归档结果：Delta 合并到 `openspec/archive/specs/`，完整 Change 移入 `openspec/archive/changes/`。

## 4. CodeSpec 与通用 open-driven / spec-driven 的区别

图中不把两者描述成“谁更好”，而是用“适用边界”做简单对比：

| 对比点 | 通用 `spec-driven` / open-driven | 默认 `code-spec` |
|---|---|---|
| 核心视角 | 由 Schema 编排一组 artifacts | 面向软件编码落地的固定协议 |
| 用户入口 | 可按 Schema 或阶段选择不同入口 | 正常开发从 `workflow` 开始 |
| 工作单元 | 由具体 Schema 定义 Change 结构 | `CHG-YYYYMMDD-NNN` + `metadata.yaml` |
| 规则中心 | 由模板、Schema 和团队约定决定 | OpenSpec Core 统一管理 Change、Requirement、Baseline、STALE、Traceability 和 archive transaction |
| 迭代方式 | 依赖所选流程约定 | 产物可回看、可修改；顺序是上下文依赖，不是僵硬瀑布门禁 |
| 规格落点 | 由 Schema 定义发布方式 | archive 事务把 Delta 合并为 Current Specification |

这里的 open-driven 用一句易懂的话解释为：**开放地按 Schema 组合和驱动产物的通用工作方式**。CodeSpec 则是为“日常开发 + AI 协作”收敛出来的默认协议。图中保留 `spec-driven` 作为显式选择的通用 Schema，不将其画成 canonical `code-spec` 的同一目录模型。

## 5. 视觉语言

- 采用适合投屏的深色背景、高对比文字和大字号；不复用现有图中信息过密的三栏总览作为最终布局。
- 蓝色表示用户输入 / 主工作流，紫色表示分析与编排，绿色表示归档提交，橙色虚线表示异常恢复。
- 主流程节点使用短标题，解释文字放在节点下方；单个节点不塞进完整段落。
- 只保留一条主阅读路径，避免交叉线；所有箭头有明确语义，并提供小型图例。
- 代码字体用于命令、路径和文件名；中文说明使用易读的无衬线字体。

## 6. 成功标准

投屏讲解者可以按图完成以下 5 分钟说明，而无需补充另一张架构图：

1. 观众能指出第一次使用时应输入哪个入口。
2. 观众能说出三个 Skill 分别在正常开发、异常恢复和最终归档中的职责。
3. 观众能解释为什么 `propose / apply / verify` 等不再是独立公开 Skill。
4. 观众能从 `proposal.md` 走到 `verification.md`，说出每份产物解决的问题。
5. 观众能理解 `Current Specification` 只在 archive 事务中更新。
6. SVG 可通过图形校验并成功导出 PNG；导出的 PNG 在实际查看时无文字重叠、箭头穿过节点或信息裁切。

## 7. 输出文件

- `assets/codespec-workflow-guide.svg`：可编辑、可嵌入文档的主图。
- `assets/codespec-workflow-guide.png`：投屏和分享用的栅格导出。
- `docs/code-spec-workflow-guide.md`：与图一一对应的讲解稿和产物说明，作为文字版补充，不重复实现细节。

