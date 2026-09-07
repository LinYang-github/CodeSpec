# CodeSpec 当前规格收敛设计

## 目标

将 `codespec/specs/` 作为已实现业务行为的唯一长期来源。

完成的 Change 将内容合并到当前模块规格，更新全工程业务关系摘要，然后删除自身目录。不再保留归档 Change 目录或 Change 历史副本。

测试用例以可读的 Markdown 保存在 `spec.md` 中。涉及 UI 的测试步骤必须在实际工程中验证。

## 已确认的决策

1. 设计确认与任务确认是两次独立的用户门禁。
2. 每个模块长期保留三份规格文件：

   ```text
   codespec/specs/<模块>/
   ├── spec.md
   ├── interface.md
   └── api.md
   ```

3. `spec.md` 保存 Requirement、Scenario 和可读测试用例。不保留 `test-cases.md`。
4. `interface.md` 是跨模块关系的权威来源。全工程流程图动态汇总所有模块的 `interface.md`，不保存单独的图文件。
5. `api.md` 保存实际路由及该路由的输入、输出业务模块编号。它不保存 HTTP 方法、请求数据、响应数据、错误或模块名称。
6. `business.md` 保留为全工程业务模块注册表。归档事务自动更新其输入、输出和关联模块列。
7. UI Change 必须具备可启动的真实工程和浏览器 E2E 环境。缺少该环境时不能归档。

## 不做什么

- 不为新的 Change 创建 `archive/changes/`、Change 快照或单独的关系图文件。
- 不允许 workflow 或 UI 直接编辑当前规格。只有归档事务可以写入。
- 不定义 CodeSpec UI 的最终页面布局。关系图需要的数据由本设计定义，界面设计另行确认。
- 不自动删除已有归档目录。该迁移属于破坏性操作，需要单独取得用户授权。

## 生命周期与确认

```text
ANALYZE
  -> DESIGN -- 用户独立确认设计 --> TASKS
  -> TASKS  -- 用户独立确认任务 --> IMPLEMENT
  -> VERIFY -> ARCHIVE -> 删除 Change
```

用户界面、命令和提示统一使用“任务”。内部为兼容现有状态机时可以继续使用 `PLAN`。

每次确认保存 Change revision、内容指纹和确认时间。确认只对该版本内容有效：

- **设计确认**：覆盖 `design.md` 与 `spec.md` 的 Requirement、Scenario 内容。
- **任务确认**：覆盖 `tasks.md`、`spec.md` 中的测试用例与验证计划。

workflow 在生成设计后停止，在生成任务后再次停止。两个阶段分别需要新的用户消息和显式确认命令。一次确认不能跨越两个阶段。

语义上的设计变更、任务或测试用例变更、rebase、冲突裁决都会增加 revision，并撤销受影响的确认。仅补充已验证的 UI 文件路径或控件定位，且不改变用户可见流程、输入和预期结果时，可以保留确认。

## 活动 Change 文件

活动 Change 是临时工作区，只保留以下文件：

```text
codespec/changes/<change-id>/
├── metadata.yaml
├── design.md
├── spec.md
├── tasks.md
└── verification.md
```

- **`metadata.yaml`**：状态、两次确认、revision 和门禁索引。
- **`design.md`**：目标、范围、模块影响、路由和接口关系增量、UI 源码定位。
- **`spec.md`**：Requirement、Scenario 和其测试用例增量。
- **`tasks.md`**：实施任务与 Requirement、Scenario、测试用例 ID 的关联。
- **`verification.md`**：实际执行的验证命令和证据。

不创建 `proposal.md`、`contracts.md` 或 `test-cases.md`。

## 模块规格文件

### `spec.md`

`spec.md` 是其他平台可直接输入的可读 Markdown。测试用例紧跟所属 Scenario，不需要单独文件或重复关联字段。

```md
## MOD-002-REQ-001：管理员新增用户

#### Scenario: SCN-001 新增有效用户
- GIVEN 管理员已登录，用户名未被使用
- WHEN 管理员提交合法用户信息
- THEN 用户列表出现新用户
- ERROR 参数不合法时不创建用户并提示错误

### 测试用例

#### TC-SCN-001-UI-01：管理员新增有效用户

- **类型：** UI E2E
- **自动化测试：** `e2e/user-management/add-user.spec.ts`
- **工程定位：** `/users`；`UserManagementPage.tsx`；按钮“新增用户”

| 步骤 | 用户操作 | 预期结果 |
|---|---|---|
| 1 | 进入“用户管理”界面 | 显示标题和“新增用户”按钮 |
| 2 | 点击“新增用户” | 显示新增用户表单 |
| 3 | 输入合法信息并确认 | 用户列表出现新用户 |
```

Markdown 使用固定结构：固定标题层级、固定字段名和“步骤 / 用户操作 / 预期结果”三列表格。Core 通过 Markdown AST 解析，不使用正则表达式。需要 JSON 或 CSV 时，由该 Markdown 转换，不长期保存重复副本。

### `interface.md`

`interface.md` 保存详细的模块关系契约。每条关系包含：

- 稳定的关系 ID。
- 输入模块与输出模块。
- 实际路由或事件名称。
- 输入、输出与错误语义。
- 关联的 Requirement 和 Scenario ID。

同一关系在输入模块和输出模块中使用相同关系 ID。Core 校验两侧关系是否一致。调用需要 HTTP 方法时，可以在本文件记录，不能写入 `api.md`。

### `api.md`

`api.md` 以当前模块为中心，记录实际路由及路由级的上下游模块编号：

```md
# 用户管理 API 路由

| 路由 | 输入业务模块 | 输出业务模块 |
|---|---|---|
| `/api/users/add` | MOD-001 | MOD-003 |
| `/api/users/{id}` | MOD-001 | — |
```

输入模块表示调用该路由的上游业务模块。输出模块表示该路由处理后调用或触发的下游业务模块。模块 ID 使用 `MOD-###`，模块名称和职责在 `business.md` 查询。

路由键为规范化路由路径。相同路由只保留一行。归档时发现路由所有权、删除、替换或关系契约冲突，必须由用户裁决。

## 全工程业务关系摘要

归档事务解析所有当前 `interface.md`，构建有向模块图，并更新 `business.md` 的生成列：

```md
| 模块编号 | 业务模块 | 输入 | 输出 | 关联模块 |
|---|---|---|---|---|
| MOD-001 | Web 用户门户 | 用户管理操作 | 用户管理请求 | MOD-002 |
| MOD-002 | 用户管理 | 用户管理请求 | 用户资料、用户生命周期事件 | MOD-001；MOD-003 |
| MOD-003 | 通知管理 | 用户生命周期事件 | 通知结果 | MOD-002 |
```

`business.md` 只表达业务模块和业务概念。它不记录 CRUD 操作或具体 API 路由。详细关系在 `interface.md`，路由级模块映射在 `api.md`。CodeSpec UI 的全工程关系图读取同一份解析结果。

## UI 测试用例一致性

每条 `UI E2E` 测试用例经过两个阶段的检查：

1. **设计和任务阶段**：读取工程源码，确认页面路由、页面标题、组件和语义控件。
2. **验证阶段**：启动实际工程，在浏览器执行 E2E，确认文档中的步骤、可见文案和预期结果可以执行。

测试使用语义角色和可访问名称，不使用 CSS class、DOM 层级或像素位置。每个 Scenario 至少有一个测试用例。每个测试用例关联自动化测试和当前验证证据。

UI Change 没有可运行 E2E 环境时，不能通过验证或归档。非 UI 行为可以使用 unit 或 integration 测试，但仍必须满足 Requirement → Scenario → Test Case → Evidence 的关联链。

## 归档事务

1. 读取活动 Change、受影响模块的当前规格，以及计算全工程关系所需的所有 `interface.md`。
2. 校验两次确认、Requirement/Scenario/测试用例关联、任务关联、路由唯一性、关系镜像、源码定位和当前 E2E 证据。
3. 准备受影响模块的 `spec.md`、`interface.md`、`api.md` 合并结果，并重建 `business.md` 的关系摘要。
4. 路由或关系无法安全合并时，在写入前停止。用户选择保留、替换或并存后，才继续归档。
5. 原子写入全部模块规格和 `business.md`，然后删除活动 Change 目录及索引条目。
6. 任一步失败时，恢复全部模块规格和 `business.md`，活动 Change 保持不变，等待修复后重试。

## 兼容与迁移

现有模块最初只有 `spec.md`。迁移为没有关系或路由的模块创建空的规范 `interface.md` 与 `api.md`，然后校验三文件结构。

新规则只应用于后续归档。已有归档 Change 目录不会被当前关系图读取，也不会自动删除。

## 验收检查

- 未取得新的设计确认时，workflow 不能进入任务阶段。
- 未取得新的任务确认时，workflow 不能进入实现阶段。
- 成功归档后不保留活动或归档 Change 副本，但原子更新受影响模块的三份规格和 `business.md`。
- 重复路由不会在 `api.md` 重复出现。冲突路由或关系没有用户裁决时不能归档。
- `business.md` 与从 `interface.md` 解析出的全工程模块关系一致。
- 每个 Scenario 都关联至少一个可读 Markdown 测试用例和 PASS 证据。
- UI 测试用例的页面、控件或操作在浏览器中无法执行时，验证失败。
