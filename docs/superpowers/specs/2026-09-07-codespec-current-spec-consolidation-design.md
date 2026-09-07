# CodeSpec 当前规格收敛设计

## 目标

将 `codespec/specs/` 作为已实现模块行为的唯一长期来源。`business.yaml` 是由模块关系生成的根级注册表，`configuration.yaml` 是当前验证环境的根级连接快照。CodeSpec 不维护 Change 历史，项目自身的 Git 历史不受本规则影响。

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
9. `spec.md` 是 Requirement、Scenario、测试用例和当前工程文件的唯一规范来源。`design.md` 只记录目标、取舍与范围，并通过 ID 引用 `spec.md`，不重复行为内容。

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
- **任务确认**：覆盖 `tasks.yaml` 中的实施任务、`moduleDeltas`、验证计划与计划修改文件，以及 `spec.md` 中的测试用例。

workflow 在生成设计后停止，在生成任务后再次停止。两个阶段分别需要新的用户消息和显式确认命令。一次确认不能跨越两个阶段。“新的用户消息”由 workflow skill 或 UI 会话协议保证；Core 强制独立的确认命令、当前 revision 和内容指纹，不声称 CLI 可以识别聊天消息。

语义上的设计变更、任务、测试用例、计划修改文件或配置增量变更、rebase、冲突裁决都会增加 revision，并撤销受影响的确认。Core 使用固定 AST/YAML 字段集合比较旧版本与新版本：仅补充已验证的 UI 源码路径或控件定位，且不改变用户可见流程、输入和预期结果时，可以保留确认；其余变更都撤销对应确认。所有 Change 产物写入必须经过同一分类服务，并原子更新 revision、确认状态和内容指纹。

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

- **`metadata.yaml`**：Change ID、工程基准、状态、两次确认、revision 和门禁索引。它保留兼容字段 `schema_version: 1`，是唯一不使用 `version: 1` 的 YAML 文件。
- **`design.md`**：目标、范围、模块影响、关联 Requirement ID、设计取舍和 UI 源码定位。
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
    status: DONE
    module: MOD-002
    requirements: [MOD-002-REQ-001]
    scenarios: [MOD-002-REQ-001-SCN-001]
    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]
    plannedFiles:
      - src/pages/UserManagementPage.tsx
      - src/services/user-service.ts
      - e2e/user-management/add-user.spec.ts
    verificationPlan:
      - testCase: MOD-002-REQ-001-SCN-001-TC-UI-01
        runner: playwright
        command: pnpm playwright test e2e/user-management/add-user.spec.ts --grep "TC-UI-01"
        profile: test
        services: [user-service]
        prepare: 创建隔离测试用户
        cleanup: 删除隔离测试用户
moduleDeltas:
  - module: MOD-002
    interfaces:
      upsert:
        - id: REL-CHG-20260907-001-01
          kind: http
          fromModule: MOD-001
          toModule: MOD-002
          path: /api/users/add
          method: POST
          input: 用户管理请求
          output: 用户资料
          errors: 参数不合法时不创建用户
          requirements: [MOD-002-REQ-001]
          scenarios: [MOD-002-REQ-001-SCN-001]
        - id: REL-CHG-20260907-001-02
          kind: event
          fromModule: MOD-002
          toModule: MOD-003
          event: user.created
          triggeredBy:
            - path: /api/users/add
              method: POST
          input: 用户生命周期事件
          output: 通知结果
          errors: 通知失败记录重试状态
          requirements: [MOD-002-REQ-001]
          scenarios: [MOD-002-REQ-001-SCN-001]
      remove: []
    configurationChanges:
      upsert:
        - profile: test
          service: user-service
          hostAlias: user-service-test
          endpointFingerprint: "sha256:61d2bd9a5a6406a66ccde3f39720a75e58ed3dc339b9f3f81bca9f53bc9558ec"
          routeBindings:
            - module: MOD-002
              path: /api/users/add
          source:
            kind: repo-file
            file: .env.test
            format: dotenv
            key: USER_SERVICE_BASE_URL
      remove: []
moduleRegistrations:
  upsert: []
  retire: []
```

```yaml
version: 1
testCases:
  - id: MOD-002-REQ-001-SCN-001-TC-UI-01
    result: PASS
    testFile: e2e/user-management/add-user.spec.ts
    testId: TC-UI-01
    command: pnpm playwright test e2e/user-management/add-user.spec.ts --grep "TC-UI-01"
    profile: test
    services: [user-service]
    browser: chromium
    exitCode: 0
    commit: 9ec4bf1
    workingTreeFingerprint: "sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365"
    executedAt: "2026-09-07T10:30:00+08:00"
    summary: 新用户出现在用户列表中
```

`moduleDeltas` 是活动 Change 中关系和运行配置的唯一机器可合并增量。`upsert` 写入完整对象，`remove` 只写稳定 ID 或 `profile/service` 键。`api.yaml` 由归档事务从已确认的 HTTP 关系和事件触发关系重建，不接受独立的路由增量。归档只能使用经任务确认的增量，不从 `design.md` 推断结构化内容。

`moduleRegistrations` 是业务模块注册的唯一活动增量。新增或重命名模块必须在 `upsert` 中提供 `id` 与 `name`；停用模块写入 `retire`，删除模块仍需用户裁决。归档后，`business.yaml` 的 `id`、`name` 与停用状态来自注册增量，其输入、输出和关联模块由 `interface.yaml` 重新生成。

任务状态只能为 `PENDING`、`IN_PROGRESS` 或 `DONE`。状态与 `verification.yaml` 的实际执行结果是执行期字段，不进入任务确认内容指纹；实施任务、计划修改文件、验证计划、`moduleDeltas` 和模块注册是计划字段，任一变更都会撤销任务确认。

除 `metadata.yaml` 外，所有 YAML 文件以 `version: 1` 开始，使用固定字段名和数组类型。Core 通过 YAML schema 解析，拒绝未知字段、缺少必填字段、重复 ID 和无法解析的引用。动态 profile 与服务键由 `profile`、`service` 字段表达，不使用 YAML map key 作为标识。

YAML Schema 对象默认 `additionalProperties: false`。模块 ID、Requirement、Scenario 和测试用例 ID 全局唯一；关系 ID 使用 `REL-CHG-YYYYMMDD-NNN-##`，由创建该关系的 Change ID 分配，因此多活动 Change 不会冲突；任务 ID 使用 Change 前缀；运行配置服务的唯一键是 `profile/service`。列表按稳定 ID 或规范化路径排序，重复项在解析时拒绝。`business.yaml.status` 只能为 `ACTIVE` 或 `RETIRED`，`tasks.yaml.status` 只能为 `PENDING`、`IN_PROGRESS` 或 `DONE`。

| 文件 | 必填根字段 | 唯一键 |
|---|---|---|
| `tasks.yaml` | `version`、`tasks`、`moduleDeltas`、`moduleRegistrations` | task ID、模块增量中的 relation ID、规范化 route path、`profile/service` |
| `verification.yaml` | `version`、`testCases` | 全局 Test Case ID |
| `interface.yaml` | `version`、`module`、`relations` | 全局 relation ID |
| `api.yaml` | `version`、`module`、`routes` | 模块内规范化 route path |
| `business.yaml` | `version`、`modules` | 全局模块 ID |
| `configuration.yaml` | `version`、`profiles` | profile ID、profile 内 service ID |

嵌套对象合同如下：

- **`moduleRegistrations.upsert`**：`id`、`name` 必填；`retire` 只包含模块 ID。
- **`interfaces.upsert`**：完整 HTTP 或 event relation；HTTP 禁止 `event` 和 `triggeredBy`，event 禁止 `path` 和 `method`。`interfaces.remove` 只包含全局 relation ID。
- **`configurationChanges.upsert`**：完整 profile/service 对象；`routeBindings` 的每项必须有 `module` 与规范化 `path`。`remove` 只包含 `profile/service`。
- **`verificationPlan`**：`testCase`、`runner`、`command`、`profile`、`services`、`prepare`、`cleanup` 全部必填。`verification.yaml` 的相同测试用例必须记录 `testFile`、`testId`、`browser`、`exitCode`、工程版本和执行时间。

每条 relation 只能在一个活动 `moduleDeltas` 条目中声明，且该条目的 `module` 必须是 relation 的端点。归档自动向另一端写入镜像。关系删除后，Core 重新生成 `api.yaml`；仍被 event `triggeredBy`、运行配置绑定或其他关系引用的路径不能删除。配置变更的外层 `module` 只用于 Change 分组，模块归属以每个 `routeBindings` 条目为准，因此一个服务可绑定多个模块。

## 模块规格文件

### `spec.md`

`spec.md` 是其他平台可直接输入的可读 Markdown。测试用例紧跟所属 Scenario，不需要单独文件或重复关联字段。

活动 Change 的工程文件章节只列出本次 Change 新增、修改或删除的工程文件。归档后的同一章节维护该模块当前有效的完整工程文件清单，不保存 Change 历史。每个文件关联至少一个 Requirement、Scenario 或测试用例，避免出现无上下文的路径列表。

```md
# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

## MOD-002-REQ-001：管理员新增用户

#### Scenario: MOD-002-REQ-001-SCN-001 新增有效用户
- GIVEN 管理员已登录，用户名未被使用
- WHEN 管理员提交合法用户信息
- THEN 用户列表出现新用户
- ERROR 参数不合法时不创建用户并提示错误

### 测试用例

#### MOD-002-REQ-001-SCN-001-TC-UI-01：管理员新增有效用户

- **类型：** UI E2E
- **自动化测试：** `e2e/user-management/add-user.spec.ts`
- **测试标识：** `TC-UI-01`
- **工程定位：** `/users`；`UserManagementPage.tsx`；按钮“新增用户”
- **最近验证：** PASS
- **验证来源：** `git:9ec4bf1`；工作区内容指纹 `sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365`
- **执行命令：** `pnpm playwright test e2e/user-management/add-user.spec.ts --grep "TC-UI-01"`
- **验证环境：** `test`；服务 `user-service`；浏览器 `chromium`；退出码 `0`
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
| `src/pages/UserManagementPage.tsx` | 用户管理页面与“新增用户”入口 | `MOD-002-REQ-001`；`MOD-002-REQ-001-SCN-001` |
| `src/services/user-service.ts` | 用户创建接口调用 | `MOD-002-REQ-001`；`MOD-002-REQ-001-SCN-001` |
| `e2e/user-management/add-user.spec.ts` | 新增用户 UI 自动化测试 | `MOD-002-REQ-001-SCN-001-TC-UI-01` |
```

活动 Change 的同一表格额外使用“变更”列，值为“新增”“修改”或“删除”。归档时移除该列及“删除”的行，并合并其余行到完整清单。文件路径必须是仓库内的实际工程文件，路径重命名视为删除旧路径并新增新路径。

活动 Change 中尚未执行的测试用例使用“最近验证：待验证”。归档后的每个测试用例必须保存最近一次 PASS 的工程版本、测试文件与标识、执行命令、环境 profile、依赖服务、浏览器、退出码、时间和结果摘要。工程版本使用 Git 提交与工作区内容指纹。报告路径只在该报告是仓库内稳定文件时记录，不能把会被清理的临时报告当作长期证据。这是最近验证记录，不是可重建 Change 的长期审计证据；提交不可解析或工作区指纹不匹配时，UI 必须标记该记录为过期。

Requirement、Scenario 和测试用例 ID 分别使用 `MOD-###-REQ-###`、`MOD-###-REQ-###-SCN-###`、`MOD-###-REQ-###-SCN-###-TC-<类型>-##`。工程文件关联单元格只允许使用反引号包裹的全局 ID，并以 `；` 分隔和按字典序排列。`规格版本` 只能为 `legacy` 或 `1`。Markdown 使用固定结构：固定标题层级、固定字段名和“步骤 / 用户操作 / 预期结果”三列表格。Core 通过 Markdown AST 解析，不使用正则表达式。需要 JSON 或 CSV 时，由该 Markdown 转换，不长期保存重复副本。

### `interface.yaml`

`interface.yaml` 保存详细的模块关系契约。每条关系是一条有向模块边，且文件的 `module` 必须是该边的 `fromModule` 或 `toModule`。同一关系只镜像在两个端点模块中。

```yaml
version: 1
module: MOD-002
relations:
  - id: REL-CHG-20260907-001-01
    kind: http
    fromModule: MOD-001
    toModule: MOD-002
    path: /api/users/add
    method: POST
    input: 用户管理请求
    output: 用户资料
    errors: 参数不合法时不创建用户
    requirements: [MOD-002-REQ-001]
    scenarios: [MOD-002-REQ-001-SCN-001]
  - id: REL-CHG-20260907-001-02
    kind: event
    fromModule: MOD-002
    toModule: MOD-003
    event: user.created
    triggeredBy:
      - path: /api/users/add
        method: POST
    input: 用户生命周期事件
    output: 通知结果
    errors: 通知失败记录重试状态
    requirements: [MOD-002-REQ-001]
    scenarios: [MOD-002-REQ-001-SCN-001]
```

HTTP 关系必填 `path` 与 `method`，事件关系必填 `event`，且由 HTTP 请求引发的事件必须以 `triggeredBy` 指向路径和方法；两种关系都必须包含稳定关系 ID、两个端点、输入、输出、错误语义、Requirement 和全局 Scenario ID。Core 校验镜像关系的规范化对象一致。HTTP 关系的 `path` 必须与 `api.yaml` 的规范化路径相同。调用方法只在本文件记录，不能写入 `api.yaml`。

### `api.yaml`

`api.yaml` 以当前模块为中心，记录实际路由及路由级的上下游模块编号：

```yaml
version: 1
module: MOD-002
routes:
  - path: /api/users/add
    inputModules: [MOD-001]
    outputModules: [MOD-003]
```

输入模块表示调用该路由的上游业务模块。输出模块表示该路由处理后调用或触发的下游业务模块。模块 ID 使用 `MOD-###`，模块名称和职责在 `business.yaml` 查询。

路由键为规范化路径：必须以 `/` 开头、移除尾随 `/`（根路径除外）、保留参数名、拒绝 query、fragment、绝对 URL 和编码歧义。相同路径只保留一行。输入模块是以当前模块为终点、且同路径的 HTTP 关系起点模块的有序去重并集；输出模块是以当前模块为起点、且 `triggeredBy` 指向该路径的事件关系终点模块的有序去重并集。精确的方法级关系只在 `interface.yaml` 查询。归档时发现路由所有权、删除、替换或关系契约冲突，必须由用户裁决。

## 工程运行配置

`codespec/configuration.yaml` 是 CodeSpec 对当前工程运行连接的可验证快照。它位于 `business.yaml` 同级，不属于任一模块的第四份规格文件。

```yaml
version: 1
profiles:
  - id: test
    services:
      - id: user-service
        hostAlias: user-service-test
        endpointFingerprint: "sha256:61d2bd9a5a6406a66ccde3f39720a75e58ed3dc339b9f3f81bca9f53bc9558ec"
        routeBindings:
          - module: MOD-002
            path: /api/users/add
        source:
          kind: repo-file
          file: .env.test
          format: dotenv
          key: USER_SERVICE_BASE_URL
```

每个服务配置必须包含：环境 profile、服务 ID、主机别名、逐条模块与路由绑定，以及工程内实际配置的来源。服务必须恰好提供一个 `endpoint`（非敏感地址）或 `endpointFingerprint`（敏感地址），不能同时提供。模块编号必须存在于 `business.yaml`，路由必须存在于相应模块的 `api.yaml`，来源文件必须位于仓库内。

首期只支持 `repo-file` 来源和 `dotenv`、JSON、YAML 三种格式。`dotenv` 的 `key` 是直接键名，JSON/YAML 的 `key` 是 JSON Pointer。包含变量插值的值、缺失键、无法解析的 JSON/YAML 或不受支持的来源都会停止验证和归档。运行时配置的权威来源始终是工程自身的仓库内配置文件或部署清单。CodeSpec 只读取该来源，比较解析值与非敏感 `endpoint`，或比较解析值的 SHA-256 指纹与 `endpointFingerprint`；不一致时停止验证和归档，要求先更新已确认的 `moduleDeltas.configurationChanges` 并重新确认任务。归档只在验证通过时原子更新该快照。

`configuration.yaml` 不保存密码、Token、证书、Cookie、原始环境变量值或其他密钥。连接地址属于敏感基础设施信息时，只保存主机别名、指纹与来源字段，不保存原始 IP 或 URL。所有解析或比对错误必须使用主机别名与来源键名，不回显配置值。

## 追溯规则

Core 从 `spec.md` 的 Markdown AST 和其余 YAML 文件建立内存追溯图，不保存第四份模块规格或独立的追溯索引文件。任意节点都必须能反向查到关联节点。

| 节点 | 必须关联到 | 连接方式 | 有效状态 |
|---|---|---|---|
| 模块规格文件 | `business.yaml` 中的模块 | `module: MOD-###` 或 `spec.md` 文件头的模块编号 | 活动与归档后 |
| Requirement | 模块、一个或多个 Scenario | Requirement ID | 活动与归档后 |
| Scenario | 一个 Requirement、至少一个测试用例 | 全局 Scenario ID | 活动与归档后 |
| 测试用例 | Scenario、自动化测试文件、最近验证摘要 | 全局 Test Case ID 与工程文件路径 | 活动与归档后 |
| 工程文件 | 一个或多个 Requirement、Scenario 或测试用例 | 仓库相对路径 | 活动与归档后 |
| 任务 | Requirement、Scenario、测试用例、计划修改文件与验证计划 | 任务 ID 和关联 ID / 路径 | 仅活动 Change |
| 接口关系 | 起点模块、终点模块、Requirement、Scenario | 关系 ID | 活动与归档后 |
| API 路径 | 输入模块、输出模块、同路径 HTTP 关系集合 | 规范化路由路径 | 活动与归档后 |
| 运行配置服务 | 模块、路由和工程内实际配置 | `profile/service`、路由绑定、来源字段 | 活动与归档后 |
| `business.yaml` 的模块项 | 模块规格与相邻模块 | 模块 ID 与解析出的关系 | 活动与归档后 |

模块规格文件只能描述一个模块。活动 Change 可以影响多个模块，因此其 Requirement、工程文件和任务条目都必须标明所属 `MOD-###`。工程文件允许在多个模块的 `spec.md` 出现，但每个模块条目必须说明该模块的职责。Change 修改共享文件时，必须同时更新所有受影响模块的条目，或在归档前取得用户的冲突裁决。

所有路径使用仓库相对 POSIX 路径。Core 拒绝绝对路径、`..`、越界符号链接和大小写不一致的重复路径，并以 realpath 确认现存文件未逃出仓库。工程文件必须是 Git 已跟踪文件或非 ignored 的工作区文件；删除路径只能出现在活动 Change 增量中。运行配置来源可以是仓库内的 ignored 文件，但只读取其允许键值并绝不写入、复制或回显原始值。

Core 在归档前校验全部 ID、模块编号、路径和路由键均可解析，并校验运行配置快照与工程实际配置一致。活动 Change 中可从 Requirement 查询任务、验证计划和实际执行；归档后只保留 Requirement、工程文件、接口、路由、测试和最近验证摘要的追溯。Core 不能查询已删除 Change 的任务或详细执行历史。

## 全工程业务关系摘要

归档事务解析所有当前 `interface.yaml`，构建有向模块图，并更新 `business.yaml` 的生成字段：

```yaml
version: 1
modules:
  - id: MOD-001
    name: Web 用户门户
    status: ACTIVE
    inputs: [用户管理操作]
    outputs: [用户管理请求]
    relatedModules: [MOD-002]
  - id: MOD-002
    name: 用户管理
    status: ACTIVE
    inputs: [用户管理请求]
    outputs: [用户资料, 用户生命周期事件]
    relatedModules: [MOD-001, MOD-003]
  - id: MOD-003
    name: 通知管理
    status: ACTIVE
    inputs: [用户生命周期事件]
    outputs: [通知结果]
    relatedModules: [MOD-002]
```

`business.yaml` 只表达业务模块和业务概念。`id`、`name` 与 `status` 是受控注册字段，输入、输出和关联模块是归档生成字段。它不记录 CRUD 操作或具体 API 路由。详细关系在 `interface.yaml`，路由级模块映射在 `api.yaml`。CodeSpec UI 的全工程关系图读取同一份解析结果。

关系的 `input` 表示从 `fromModule` 交给 `toModule` 的业务概念，因此生成到起点的 `outputs` 和终点的 `inputs`。关系的 `output` 表示终点模块产生的业务结果，因此生成到 `toModule.outputs`。每个模块的 `relatedModules` 是所有相邻端点的有序去重集合。生成字段按模块 ID 和文本排序，不接受人工编辑。

停用模块前，Change 必须删除其全部 active relation、API 投影和运行配置绑定。归档后模块规格保留为只读当前记录，`business.yaml.status` 设为 `RETIRED`，并从全工程运行关系图和 API 投影排除。重新启用模块必须通过新的 `moduleRegistrations.upsert`、关系和配置增量重新建立全部追溯。

## UI 测试用例一致性

每条 `UI E2E` 测试用例经过两个阶段的检查：

1. **设计和任务阶段**：读取工程源码，确认页面路由、页面标题、组件和语义控件。
2. **验证阶段**：启动实际工程，在浏览器执行 E2E，确认文档中的步骤、可见文案和预期结果可以执行。

测试使用语义角色和可访问名称，不使用 CSS class、DOM 层级或像素位置。每个 Scenario 至少有一个测试用例。每个测试用例关联自动化测试和当前验证证据。验证计划必须使用 runner 内唯一测试标识精确选择目标 case；只有该 case 实际执行、结果 PASS、退出码为 0、环境 profile 与配置快照一致且准备/清理动作成功时，才可归档。SKIP、仅执行同文件其他 case 或留下测试数据都视为验证失败。

UI Change 没有可运行 E2E 环境时，不能通过验证或归档。非 UI 行为可以使用 unit 或 integration 测试，但仍必须满足 Requirement → Scenario → Test Case → Evidence 的关联链。

## 归档事务

1. 读取活动 Change、受影响模块的当前规格，以及计算全工程关系所需的所有 `interface.yaml`。关系端点与共享文件自动扩展受影响模块集合。
2. 校验两次确认、所有任务为 `DONE`、验证计划与实际执行一致、Requirement/Scenario/测试用例关联、任务关联、受确认的 `moduleDeltas`、工程文件增量与实际变更一致、归档后文件清单中的路径存在、路由唯一性、由关系推导出的 API 上下游模块、关系镜像、源码定位、运行配置快照和当前 E2E 证据。
3. 路由、关系、注册或配置无法安全合并时，在写入前停止。用户选择保留、替换或并存后，增加 revision、撤销受影响确认并重新生成任务增量。
4. 在 `codespec/.transactions/<transaction-id>/` 写入持久 journal、每个目标文件的旧值与新值校验和、暂存新文件和安装顺序。该目录是可恢复的短期事务状态，不是 Change 历史。
5. 安装全部模块规格、`business.yaml` 和 `configuration.yaml`，fsync 后写入 journal commit marker。仅在 marker 落盘后删除活动 Change 目录及索引条目，并清理事务目录。
6. 任意 CodeSpec 命令启动时发现未完成 journal，按 commit marker 恢复：未提交则还原全部旧值并保留 Change；已提交则完成 Change 删除与清理。恢复或清理失败时停止后续工作，保留 journal 供重试；重试必须幂等。

## 兼容与迁移

迁移从既有 `business.md` 转换模块 ID、名称和状态到 `business.yaml`，不能转换或重复的模块注册必须停止并要求人工映射。迁移为没有关系或路由的模块创建空的 `interface.yaml` 与 `api.yaml`，并创建空的 `configuration.yaml`。

既有 `spec.md` 标记为 `legacy`，不猜测工程文件归属、Requirement/Scenario/Test Case ID 或运行连接。未触及的 legacy 模块不参与 v1 的测试用例和 PASS 证据校验。首次有 Change 触及 legacy 模块时，必须在该 Change 中升级为 v1 完整格式，并重新取得设计与任务确认；升级后的模块参与全部新校验。

旧格式的活动 Change 不能直接进入新归档流程。workflow 尝试将其转换为新活动结构，重新生成任务、验证计划和 YAML 增量，并撤销两次确认。无法安全转换时停止，由用户选择手动迁移或放弃该 Change。已有历史归档目录保持不变，不参与迁移、关系图或自动删除。

新规则只应用于完成迁移后的后续归档。

## 验收检查

- 未取得新的设计确认时，workflow 不能进入任务阶段。
- 未取得新的任务确认时，workflow 不能进入实现阶段。
- 成功归档后不保留活动或归档 Change 副本，但原子更新受影响模块的三份规格、`business.yaml` 和 `configuration.yaml`。
- 重复路由不会在 `api.yaml` 重复出现。冲突路由或关系没有用户裁决时不能归档。
- `business.yaml` 与从 `interface.yaml` 解析出的全工程模块关系一致。
- 每条关系只连接两个模块，并在两个端点模块镜像；HTTP 与事件关系、同路径不同 HTTP 方法均可无歧义解析。
- 每个任务均为 `DONE`，其验证计划与实际 `verification.yaml` 记录的测试标识、profile、服务和命令一致。目标测试被 SKIP、未实际执行或清理失败时不能归档。
- 每个 Scenario 都关联至少一个可读 Markdown 测试用例和 PASS 证据。
- 活动 Change 的工程文件增量与实际变更一致，归档后 `spec.md` 只保留当前存在且仍归属该模块的工程文件。
- `configuration.yaml` 的模块、路由和工程配置来源均可解析，且快照连接与工程实际配置一致。
- 未经任务确认的关系、路由、注册或运行配置增量不能归档，`configuration.yaml` 不会写回工程配置来源。
- 任一目标文件安装步骤发生进程中断后，恢复结果只能是全部归档前状态或全部归档后状态；归档重试不重复合并。
- 未触及 legacy 模块不阻断新 Change；首次触及后必须升级为规格版本 `1` 并满足全部新校验。
- UI 测试用例的页面、控件或操作在浏览器中无法执行时，验证失败。
