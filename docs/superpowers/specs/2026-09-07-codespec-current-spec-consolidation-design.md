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
   ├── interface.yaml
   └── api.yaml
   ```

3. `spec.md` 保存 Requirement、Scenario、可读测试用例、最近验证摘要和当前模块工程文件。不保留 `test-cases.md`。
4. `interface.yaml` 是跨模块关系的权威来源。全工程流程图动态汇总所有模块的 `interface.yaml`，不保存单独的图文件。
5. `api.yaml` 保存实际路由及该路由的输入、输出业务模块编号。它不保存 HTTP 方法、请求数据、响应数据、错误或模块名称。
6. `business.yaml` 保留为全工程业务模块注册表。归档事务自动更新其输入、输出和关联模块列。
7. UI Change 必须具备可启动的真实工程和浏览器 E2E 环境。缺少该环境时不能归档。
8. `configuration.yaml` 保存 CodeSpec 验证时使用的工程运行连接快照及其工程配置来源。它不作为项目运行时配置来源。

## 不做什么

- 不为新的 Change 创建 `archive/changes/`、Change 快照或单独的关系图文件。
- 不允许 workflow 或 UI 直接编辑当前规格。只有归档事务可以写入。
- 不将 Requirement、Scenario 和用户操作步骤改为 YAML。它们保留在 `spec.md`，作为可读且可直接输入其他平台的行为规格。
- 不让 `configuration.yaml` 写入、覆盖或注入项目的 `.env`、部署清单、配置中心或业务代码。
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
- **任务确认**：覆盖 `tasks.yaml`、`spec.md` 中的测试用例、验证计划与计划修改文件。

workflow 在生成设计后停止，在生成任务后再次停止。两个阶段分别需要新的用户消息和显式确认命令。一次确认不能跨越两个阶段。

语义上的设计变更、任务、测试用例或计划修改文件变更、rebase、冲突裁决都会增加 revision，并撤销受影响的确认。仅补充已验证的 UI 文件路径或控件定位，且不改变用户可见流程、输入和预期结果时，可以保留确认。

验证配置的服务、工程来源或期望连接地址变更属于任务变更，需要重新取得任务确认。

## 活动 Change 文件

活动 Change 是临时工作区，只保留以下文件：

```text
codespec/changes/<change-id>/
├── metadata.yaml
├── design.md
├── spec.md
├── tasks.yaml
└── verification.yaml
```

- **`metadata.yaml`**：Change ID、工程基准、状态、两次确认、revision 和门禁索引。
- **`design.md`**：目标、范围、模块影响、Requirement、关系、路由增量和 UI 源码定位。
- **`spec.md`**：Requirement、Scenario、测试用例和本次工程文件增量。
- **`tasks.yaml`**：实施任务与 Requirement、Scenario、测试用例 ID、计划修改文件的关联。
- **`verification.yaml`**：按测试用例记录实际执行的验证命令、工程版本和结果。

不创建 `proposal.md`、`contracts.md` 或 `test-cases.md`。

工程基准由创建 Change 时的 Git 提交和工作区内容指纹组成。活动 Change 的“工程文件增量”从此基准到待归档工作区的差异计算。工程文件包括实现业务行为的源码、自动化测试、行为相关配置、数据库迁移和接口定义。`codespec/` 文档、锁文件、构建产物和临时报告不属于工程文件，除非其内容直接实现或验证该业务行为。

归档前，实际工程文件增量必须覆盖在任务的计划修改文件中。出现未计划的业务工程文件时，workflow 停止归档，更新任务并重新取得任务确认。只因工具生成而变化的排除文件记录为验证环境噪声，不写入模块 `spec.md`。

活动 Change 的 `spec.md` 工程文件表格使用“模块编号”和“变更”列。任务关联与计划修改文件只记录在 `tasks.yaml`。

活动 Change 的 `tasks.yaml` 与 `verification.yaml` 使用固定结构：

```yaml
version: 1
tasks:
  - id: CHG-20260907-001-TASK-001
    module: MOD-002
    requirements: [MOD-002-REQ-001]
    scenarios: [SCN-001]
    testCases: [TC-SCN-001-UI-01]
    plannedFiles:
      - src/pages/UserManagementPage.tsx
      - src/services/user-service.ts
      - e2e/user-management/add-user.spec.ts
```

```yaml
version: 1
testCases:
  - id: TC-SCN-001-UI-01
    result: PASS
    command: pnpm playwright test e2e/user-management/add-user.spec.ts
    commit: 9ec4bf1
    workingTreeFingerprint: "sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365"
    executedAt: "2026-09-07T10:30:00+08:00"
    summary: 新用户出现在用户列表中
```

所有 YAML 文件以 `version: 1` 开始，使用固定字段名和数组类型。Core 通过 YAML schema 解析，拒绝未知字段、缺少必填字段、重复 ID 和无法解析的引用。

## 模块规格文件

### `spec.md`

`spec.md` 是其他平台可直接输入的可读 Markdown。测试用例紧跟所属 Scenario，不需要单独文件或重复关联字段。

活动 Change 的工程文件章节只列出本次 Change 新增、修改或删除的工程文件。归档后的同一章节维护该模块当前有效的完整工程文件清单，不保存 Change 历史。每个文件关联至少一个 Requirement、Scenario 或测试用例，避免出现无上下文的路径列表。

```md
# 用户管理

- **模块编号：** MOD-002

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
- **最近验证：** PASS
- **验证来源：** `git:9ec4bf1`；工作区内容指纹 `sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365`
- **执行命令：** `pnpm playwright test e2e/user-management/add-user.spec.ts`
- **验证时间：** 2026-09-07T10:30:00+08:00
- **验证摘要：** 新用户出现在用户列表中

| 步骤 | 用户操作 | 预期结果 |
|---|---|---|
| 1 | 进入“用户管理”界面 | 显示标题和“新增用户”按钮 |
| 2 | 点击“新增用户” | 显示新增用户表单 |
| 3 | 输入合法信息并确认 | 用户列表出现新用户 |

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
|---|---|---|
| `src/pages/UserManagementPage.tsx` | 用户管理页面与“新增用户”入口 | MOD-002-REQ-001 / SCN-001 |
| `src/services/user-service.ts` | 用户创建接口调用 | MOD-002-REQ-001 / SCN-001 |
| `e2e/user-management/add-user.spec.ts` | 新增用户 UI 自动化测试 | TC-SCN-001-UI-01 |
```

活动 Change 的同一表格额外使用“变更”列，值为“新增”“修改”或“删除”。归档时移除该列及“删除”的行，并合并其余行到完整清单。文件路径必须是仓库内的实际工程文件，路径重命名视为删除旧路径并新增新路径。

活动 Change 中尚未执行的测试用例使用“最近验证：待验证”。归档后的每个测试用例必须保存最近一次 PASS 的工程版本、执行命令、时间和结果摘要。工程版本使用 Git 提交与工作区内容指纹。报告路径只在该报告是仓库内稳定文件时记录，不能把会被清理的临时报告当作长期证据。

Markdown 使用固定结构：固定标题层级、固定字段名和“步骤 / 用户操作 / 预期结果”三列表格。Core 通过 Markdown AST 解析，不使用正则表达式。需要 JSON 或 CSV 时，由该 Markdown 转换，不长期保存重复副本。

### `interface.yaml`

`interface.yaml` 保存详细的模块关系契约。每条关系包含：

- 稳定的关系 ID。
- 输入模块与输出模块。
- 实际路由键或事件名称。
- 输入、输出与错误语义。
- 关联的 Requirement 和 Scenario ID。

```yaml
version: 1
module: MOD-002
relations:
  - id: REL-001
    inputModule: MOD-001
    outputModule: MOD-003
    route: /api/users/add
    method: POST
    input: 用户管理请求
    output: 用户生命周期事件
    errors: 参数不合法时不创建用户
    requirements: [MOD-002-REQ-001]
    scenarios: [SCN-001]
```

同一关系在输入模块和输出模块中使用相同关系 ID。Core 校验两侧关系是否一致。HTTP 关系的路由键必须与 `api.yaml` 的规范化路由路径相同，作为两个文件的连接键。调用需要 HTTP 方法时，可以在本文件记录，不能写入 `api.yaml`。

### `api.yaml`

`api.yaml` 以当前模块为中心，记录实际路由及路由级的上下游模块编号：

```yaml
version: 1
module: MOD-002
routes:
  - path: /api/users/add
    inputModules: [MOD-001]
    outputModules: [MOD-003]
  - path: /api/users/{id}
    inputModules: [MOD-001]
    outputModules: []
```

输入模块表示调用该路由的上游业务模块。输出模块表示该路由处理后调用或触发的下游业务模块。模块 ID 使用 `MOD-###`，模块名称和职责在 `business.yaml` 查询。

路由键为规范化路由路径。相同路由只保留一行。归档时发现路由所有权、删除、替换或关系契约冲突，必须由用户裁决。

## 工程运行配置

`codespec/configuration.yaml` 是 CodeSpec 对当前工程运行连接的可验证快照。它位于 `business.yaml` 同级，不属于任一模块的第四份规格文件。

```yaml
version: 1

profiles:
  test:
    services:
      user-service:
        endpoint: http://10.10.0.12:8080
        modules:
          - MOD-002
        routes:
          - /api/users/add
        source:
          file: .env.test.example
          key: USER_SERVICE_BASE_URL
```

每个服务配置必须包含：环境 profile、服务 ID、连接地址或主机别名、关联模块、关联路由，以及工程内实际配置的来源文件和键名。模块编号必须存在于 `business.yaml`，路由必须存在于相应模块的 `api.yaml`，来源文件必须位于仓库内。

运行时配置的权威来源始终是工程自身的仓库内配置文件或部署清单。CodeSpec 只读取该来源，在验证前比较解析出的连接地址与 `configuration.yaml` 快照；不一致时停止验证和归档，要求先更新配置快照并重新确认任务。归档只在验证通过时原子更新该快照。

`configuration.yaml` 不保存密码、Token、证书、Cookie 或其他密钥。连接地址属于敏感基础设施信息时，只保存主机别名与来源文件、键名，不保存原始 IP 或 URL。

## 追溯规则

Core 从 `spec.md` 的 Markdown AST 和其余 YAML 文件建立内存追溯图，不保存第四份模块规格或独立的追溯索引文件。任意节点都必须能反向查到关联节点。

| 节点 | 必须关联到 | 连接方式 |
|---|---|---|
| 模块规格文件 | `business.yaml` 中的模块 | `module: MOD-###` 或 `spec.md` 文件头的模块编号 |
| Requirement | 模块、一个或多个 Scenario | Requirement ID |
| Scenario | 一个 Requirement、至少一个测试用例 | Scenario ID |
| 测试用例 | Scenario、自动化测试文件、最近验证摘要 | Test Case ID 与工程文件路径 |
| 工程文件 | 一个或多个 Requirement、Scenario 或测试用例 | 仓库相对路径 |
| 任务 | Requirement、Scenario、测试用例、计划修改文件 | 任务 ID 和关联 ID / 路径 |
| 接口关系 | 输入模块、输出模块、Requirement、Scenario | 关系 ID |
| API 路由 | 输入模块、输出模块、接口关系 | 规范化路由路径 |
| 运行配置服务 | 模块、路由和工程内实际配置 | 服务 ID、模块 ID、路由键、来源文件和键名 |
| `business.yaml` 的模块项 | 模块规格与相邻模块 | 模块 ID 与解析出的关系 |

模块规格文件只能描述一个模块。活动 Change 可以影响多个模块，因此其 Requirement、工程文件和任务条目都必须标明所属 `MOD-###`。工程文件允许在多个模块的 `spec.md` 出现，但每个模块条目必须说明该模块的职责。Change 修改共享文件时，必须同时更新所有受影响模块的条目，或在归档前取得用户的冲突裁决。

Core 在归档前校验全部 ID、模块编号、路径和路由键均可解析，并校验运行配置快照与工程实际配置一致。它还提供正向和反向查询：从需求查工程文件、接口、路由、任务、测试和验证；从工程文件、路由、关系或运行配置服务查回对应模块与业务行为。

## 全工程业务关系摘要

归档事务解析所有当前 `interface.yaml`，构建有向模块图，并更新 `business.yaml` 的生成字段：

```yaml
version: 1
modules:
  - id: MOD-001
    name: Web 用户门户
    inputs: [用户管理操作]
    outputs: [用户管理请求]
    relatedModules: [MOD-002]
  - id: MOD-002
    name: 用户管理
    inputs: [用户管理请求]
    outputs: [用户资料, 用户生命周期事件]
    relatedModules: [MOD-001, MOD-003]
```

`business.yaml` 只表达业务模块和业务概念。它不记录 CRUD 操作或具体 API 路由。详细关系在 `interface.yaml`，路由级模块映射在 `api.yaml`。CodeSpec UI 的全工程关系图读取同一份解析结果。

## UI 测试用例一致性

每条 `UI E2E` 测试用例经过两个阶段的检查：

1. **设计和任务阶段**：读取工程源码，确认页面路由、页面标题、组件和语义控件。
2. **验证阶段**：启动实际工程，在浏览器执行 E2E，确认文档中的步骤、可见文案和预期结果可以执行。

测试使用语义角色和可访问名称，不使用 CSS class、DOM 层级或像素位置。每个 Scenario 至少有一个测试用例。每个测试用例关联自动化测试和当前验证证据。

UI Change 没有可运行 E2E 环境时，不能通过验证或归档。非 UI 行为可以使用 unit 或 integration 测试，但仍必须满足 Requirement → Scenario → Test Case → Evidence 的关联链。

## 归档事务

1. 读取活动 Change、受影响模块的当前规格，以及计算全工程关系所需的所有 `interface.yaml`。
2. 校验两次确认、Requirement/Scenario/测试用例关联、任务关联、工程文件增量与实际变更一致、归档后文件清单中的路径存在、路由唯一性、关系镜像、源码定位和当前 E2E 证据。
3. 准备受影响模块的 `spec.md`、`interface.yaml`、`api.yaml` 合并结果，更新有效工程文件清单、`configuration.yaml` 和 `business.yaml` 的关系摘要。
4. 路由或关系无法安全合并时，在写入前停止。用户选择保留、替换或并存后，才继续归档。
5. 原子写入全部模块规格、`business.yaml` 和 `configuration.yaml`，然后删除活动 Change 目录及索引条目。
6. 任一步失败时，恢复全部模块规格、`business.yaml` 和 `configuration.yaml`，活动 Change 保持不变，等待修复后重试。

## 兼容与迁移

现有模块最初只有 `spec.md`。迁移为没有关系或路由的模块创建空的规范 `interface.yaml` 与 `api.yaml`，并在 `spec.md` 创建空的“当前模块工程文件”章节。迁移同时创建空的 `business.yaml` 和 `configuration.yaml`，然后校验三文件结构。迁移不猜测既有模块的文件归属或运行连接；后续 Change 归档时根据实际变更补充或修正。

新规则只应用于后续归档。已有归档 Change 目录不会被当前关系图读取，也不会自动删除。

## 验收检查

- 未取得新的设计确认时，workflow 不能进入任务阶段。
- 未取得新的任务确认时，workflow 不能进入实现阶段。
- 成功归档后不保留活动或归档 Change 副本，但原子更新受影响模块的三份规格、`business.yaml` 和 `configuration.yaml`。
- 重复路由不会在 `api.yaml` 重复出现。冲突路由或关系没有用户裁决时不能归档。
- `business.yaml` 与从 `interface.yaml` 解析出的全工程模块关系一致。
- 每个 Scenario 都关联至少一个可读 Markdown 测试用例和 PASS 证据。
- 活动 Change 的工程文件增量与实际变更一致，归档后 `spec.md` 只保留当前存在且仍归属该模块的工程文件。
- `configuration.yaml` 的模块、路由和工程配置来源均可解析，且快照连接与工程实际配置一致。
- UI 测试用例的页面、控件或操作在浏览器中无法执行时，验证失败。
