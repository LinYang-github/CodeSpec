# CodeSpec 1.0 实施进度

更新：2026-09-06。工作分支：`codex/codespec-identity-archive`。

本轮全量测试清理与发布前审计已完成；当前工作树未提交，仍需按团队流程评审后再发布 1.0.0。
实现位于隔离 worktree，主工作区的既有改动不在本轮修改范围。

## 本轮已验证

- 默认 code-spec 的 status、validate、生命周期门禁和归档预检共用异步影响校验。
- MODIFIED / REMOVED 必须映射到当前 Requirement / Scenario；虚假 none、重复映射、disposition 与 delta 不匹配都会阻塞。
- 归档回归记录必须包含成功执行的 archive-regression 命令，并关联旧、新 Requirement / Scenario；其他类别的覆盖不能替代它。
- Verification 绑定 Change revision、baseline、receipt 和 proposal/design/spec/tasks 内容哈希；产物改变后须重新验证。
- 内联设计章节不会吞掉后面的 delta；Level 1 允许独立 design.md；rebase 保留内联章节并撤销后续门禁通过标记。
- 归档提交复查 Change 全部文件及相关模块目录快照；保留模块附件，不安装仅依赖模块。
- A 被 B 替代时，只更新 Current specs，旧 Change 文件逐字节保留；历史记录包含输入 revision、映射、Evidence ID、当前模块内容哈希及递增 revision。
- CLI 在人工确认前输出预检映射与回归命令；JSON 模式返回预检但不提交，--yes 不能绕过人工确认。
- 新生成配置使用 codespec/specs/<MOD-ID>/spec.md；历史 Change 位于 codespec/archive/changes/<CHG-ID>/。
- 归档安装阶段注入失败时，当前规范、活动 Change 和历史记录恢复原状。
- 已恢复误受全局替换影响的已批准设计和实施计划原文。
- metadata 中的 SDD Level 是唯一权威；Core 会按变更类型、模块范围和 affected_areas 给出不可下调的最低等级。Level 1 必须在 spec.md 内联设计与分级依据，Level 3 必须覆盖架构、接口契约、迁移、回滚和发布。
- init 的动画和静态回退使用纯 ASCII HRHY 字标；README 的旧 OpenSpec 位图已替换为 HRHY CodeSpec SVG，旧 Dashboard 截图已删除。
- 已审计并恢复 `codespec/changes/archive/` 的历史字节内容；由机械替换生成的 14 个 `metadata.yaml` 已移除，历史 `.openspec.yaml` 仅作为不可读取的归档记录保留。
- Verification 已按 SDD Level 强制受控类别：Level 1 为 `unit/typecheck/build/lint`，Level 2 增加 `bdd/integration`，Level 3 仅按安全、迁移和性能 affected area 追加 NFR 检查；受影响归档继续要求 `archive-regression`。
- Level 3 Trace Row 现在必须带仓库内相对 `code_reference`；Core 校验路径不越界、不经过软链接且目标文件存在。
- 遥测在 HRHY 自有端点和密钥被正式配置前完全禁用：不创建 ID、不写配置、不发送网络请求；旧配置迁移已移除。
- 每次 VERIFY 从任务中的 Requirement / Scenario / `SP-*` / 测试文件引用生成结构化 Trace Row，并将 Requirement → Scenario → Task → Test → Evidence 写入 `verification.md`、机器 YAML 和 receipt；任何 Scenario 缺少 Task→Test 链路都会在命令执行前被拒绝。
- VERIFY 命令执行前后会复核 Change 产物、revision、baseline 和现有 Evidence；rebase 持有 Change 索引锁并在写入前复核所有输入快照，避免并发修改覆盖结果。
- 已完成面向用户的整体命名迁移：AI 入口、命令适配器、文档、静态 Skill 和文档技能目录统一使用 `codespec`；`docs/codespec.md` 取代旧的工作流文档入口。旧名称仅保留在兼容拒绝和历史元数据路径中。

验证记录：

- pnpm build：通过。
- pnpm typecheck：通过。
- 追踪矩阵、受控验证、归档事务、状态机、契约与默认配置聚焦回归：7 个文件、70 项通过。
- Verification 与 stale/rebase 回归新增 Level 3 code_reference、快照并发和锁恢复覆盖。
- pnpm exec vitest run test/core/codespec-workflow test/cli-e2e/codespec-workflow-journeys.test.ts test/cli-e2e/basic.test.ts：18 个文件、154 项通过。
- UI、遥测、旧 metadata 拒绝与当前规格路径聚焦回归：59 项通过。
- 发布包清单：`npm pack` 确认包名为 `@hrhy-ai/codespec@1.0.0`，唯一 CLI 文件为 `bin/codespec.js`；`pnpm check:pack-version` 已在临时目录安装 tarball 并验证 `codespec --version` 为 `1.0.0`。
- git diff --check：通过。
- 命名迁移聚焦回归：7 个文件、1,217 项通过；`pnpm typecheck` 与 `pnpm build` 通过；`pnpm generate:skills` 重新生成 3 个 CodeSpec Skill。
- 全量测试最终审计：`174` 个文件、`4,335` 项全部通过；版本检查在允许绑定本地临时端口的审计运行中 `48/48` 通过。

## 尚待完成 / 复核

- Trace Row 的代码 revision / 产物定位（Level 3 的 code reference）与跨 Change 汇总导出。受控 CI 类别已接入 workspace 配置：每类必须声明唯一 command 或不适用理由；不适用理由写入 Evidence，受影响归档的 `archive-regression` 不能跳过。
- 纯实现 bugfix（不修改既有验收行为）无语义 delta 的完整创建、验证和归档路径，以及 CLI 验证命令入口。
- 并发归档恢复策略仍需在多进程环境复核；rebase 的 Change 索引同步、归档锁 owner/PID 崩溃恢复和验证期间并发修改防护已实现。
- 完整路径祖先安全检查、归档锁崩溃恢复，以及 parser 与实际 delta 安装对 Markdown 围栏的统一处理。
- packed-install 冒烟：需要在可访问 npm 缓存/网络的环境中完成本地 tarball 安装与 `codespec --version` 验证。
- 继续审计非归档的历史素材与活动 Change，确认机械替换未意外改变需保留的输入数据。
- 全量测试失败已逐项归因并修复；受限环境下版本检查测试先在普通沙箱失败，随后在允许本地临时端口的审计运行中通过。

证据边界：本地 receipt 是一致性摘要，不是防恶意伪造的数字签名。
