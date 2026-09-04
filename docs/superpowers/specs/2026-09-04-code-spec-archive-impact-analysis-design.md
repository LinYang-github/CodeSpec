# CodeSpec 归档影响分析设计

> 状态：设计已在对话中确认；尚未开始实现。

## 决策摘要

仅为默认 `code-spec` schema 新增“归档影响分析”设计门禁。每个 Change 的 `design.md` 必须明确该 Change 是否影响现有归档能力；若有影响，必须关联既有归档 Requirement / Scenario、说明风险，并规定归档回归验证证据。其他 schema 保持不变。

该设计不要求每次 workflow 扫描历史归档目录。现有归档事务的预检、冲突检测、原子提交和人工确认仍是最终写入防线；新门禁的职责是在设计阶段识别是否可能破坏这些既有契约。

## 背景与问题

当前归档路径通过 `preflightArchive()`、`prepareArchive()`、`commitArchive()` 和 `archiveTransaction()` 执行验证、冲突检测与原子提交。但设计阶段没有统一、可校验的方式说明一次改动是否影响归档行为。仅依赖作者自行判断，可能导致变更触及归档事务、delta 合并或确认边界时，遗漏现有 Requirement 和回归验证。

## 目标

- 在 `code-spec` 设计阶段显式分析归档功能影响。
- 让“无影响”成为可审计的明确结论，而非缺失信息。
- 让归档相关 Change 追踪到既有归档 Requirement / Scenario。
- 将归档影响的验证要求写入任务和验证证据，并在归档前检查。
- 保持其他 schema、现有归档事务语义及人工确认行为不变。
- 让新增需求与既有需求冲突时，能够明确演进 Current Specification 而不改写历史归档。

## 非目标

- 不在每次普通 workflow 操作扫描 `archive/` 历史目录。
- 不改变 Current Specification 的唯一写入边界。
- 不替代既有的归档预检、冲突检测、锁、回滚或人工确认。
- 不为非 `code-spec` schema 新增该章节或校验。
- 不允许直接编辑或删除已归档 Change 中的 Requirement、Scenario 或验证证据。

## 设计

### `design.md` 的归档影响分析章节

`code-spec` 的设计模板新增必填的“归档影响分析”章节，包含以下字段：

- **结论**：只能为“无影响”或“有影响”。
- **既有归档需求检查**：列出所检查的 Current Specification 中归档 Requirement / Scenario ID；无影响也要保留检查结果。
- **受影响组件**：结论为有影响时，列出具体组件，例如 archive transaction、spec 合并、冲突检测、归档路径、幂等性、原子性、人工确认边界。
- **需求映射**：对每项相关 Requirement / Scenario 明确标注“保持满足”“修改”或“新增回归场景”。
- **风险与缓解**：说明可能的重复写入、错误合并、部分提交或确认绕过等风险及对应措施。
- **验证要求**：列出必须新增的归档回归场景、命令与证据预期。

### 设计阶段的既有需求查询

当 Change 触及归档相关代码或数据契约时，workflow 必须从 Current Specification 中定位归档能力的既有 Requirement / Scenario，并将其写入设计章节。若无法定位匹配需求，不能简单归类为“无影响”：必须标记风险，并补充所需归档需求后才能完成设计校验。

此查询只在设计影响判断及最终归档预检等有意义的节点发生；普通实现、状态查看或 rebase 不读取归档历史作为常规门禁。

### 校验与生命周期联动

`code-spec` 的设计校验应拒绝以下情况：

- 缺少归档影响分析章节；
- 结论缺失或不是明确的“无影响”/“有影响”；
- 结论为有影响但缺少既有需求关联、受影响组件、需求映射或验证要求；
- 归档相关变更没有可定位的既有需求且未显式补充需求。

若结论为有影响，workflow 应将归档回归验证项投影到 `tasks.md`，并要求 `verification.md` 记录 Requirement / Scenario 到验证命令及结果的映射。最终归档前门禁验证这些证据；缺失或失败时拒绝归档。

若结论为无影响，则只需保留检查记录，不额外增加归档测试负担；现有归档事务预检仍照常执行。

### 已归档需求的演进

归档的 Change 是不可变历史；已归档内容被人工判定失效，或新需求与其冲突时，必须创建新的 `code-spec` Change，不能回写旧 Change。新 Change 的设计必须关联旧 Requirement / Scenario，说明失效或冲突原因，并选择明确处置方式。

| 情况 | 对既有 Requirement / Scenario 的处置 | 对 Current Specification 的结果 |
| --- | --- | --- |
| 新增需求且与既有需求兼容 | 保持满足 | 以 `ADDED` 加入新 Requirement / Scenario。 |
| 新增需求导致既有需求部分失效 | 修订 | 以 `MODIFIED` 替换既有 Requirement 块为收窄后的行为，并以 `ADDED` 加入新 Requirement / Scenario。 |
| 新增需求完全取代既有需求 | 替换 / 废止 | 以 `REMOVED` 移除已失效的 Current Specification Requirement，或以 `MODIFIED` 将其改写为明确的废止状态；新 Requirement / Scenario 以 `ADDED` 加入。 |
| `bugfix` 且既有需求意图不变 | 保持满足 | 不修改 Requirement / Scenario，只记录关联、修复任务与验证证据。 |
| `bugfix` 发现既有需求语义错误或含混 | 修订或替换 | 不再按纯 bugfix 处理，升级为上面的修订或替换路径。 |

对于部分失效或完全替代，新 Change 必须记录旧新映射、处置类型和原因，例如 `REQ-A / SCN-A → REQ-B / SCN-B (superseded)`。归档摘要在人工确认前展示该映射。

默认 `code-spec` workspace 的 Current Specification 位于 `openspec/specs/<模块编号>/spec.md`。归档事务先读取该文件，再对新 Change 的 delta 执行 `ADDED`、`MODIFIED` 或 `REMOVED`，并以事务方式安装整个更新后的模块文件。`MODIFIED` 和 `REMOVED` 必须携带与当前 Requirement 块完全匹配的 `previous` 内容；若不匹配，归档以 `ARCHIVE CONFLICT` 失败，不会覆盖现有内容。

旧 Change 的快照始终保留在 `openspec/archive/changes/<CHG-ID>/`。因此，Current Specification 反映当前有效规则，归档 Change 则保留每一版规则为何存在、何时被替代及其验证证据。

## 错误处理

- 无法读取或解析既有归档 Requirement / Scenario：停止设计校验，提示补齐可追溯关联。
- 影响分析不完整：阻止设计完成，指出缺失字段。
- 归档影响验证未完成或失败：阻止验证完成及最终归档，保留 Change 供修复后重新验证。
- 归档事务失败：继续沿用现有事务回滚与恢复语义，不产生半写入的 Current Specification 或半移动的 Change。

## 测试策略

- 验证 `code-spec` 模板生成必填章节，其他 schema 不生成也不校验该章节。
- 验证缺章节、模糊结论及“有影响”字段不完整时设计校验失败。
- 验证触及归档范围却未关联既有归档 Requirement / Scenario 时失败。
- 验证“无影响”且未触及归档范围的 Change 可通过。
- 验证“有影响”时，缺失归档回归证据不可归档；补齐关联和证据后可归档。
- 验证兼容新增、部分修订、完全替代和纯 bugfix 的 Requirement delta 分别产生预期的 Current Specification。
- 验证 `MODIFIED` 或 `REMOVED` 的 `previous` 不匹配时，归档以冲突失败，原 Current Specification 与历史 Change 均保持不变。
- 保留并运行既有归档事务、冲突检测及人工确认回归测试，确认原有保障不变。

## 受影响范围

- `schemas/code-spec/templates/design.md`
- `schemas/code-spec/schema.yaml` 及 `code-spec` 专用验证逻辑
- `src/core/templates/workflows/*` 中的 `code-spec` workflow 指令
- `src/core/openspec-workflow/*` 中的设计、追踪和归档门禁实现
- 对应模板、验证、workflow 与归档事务测试
