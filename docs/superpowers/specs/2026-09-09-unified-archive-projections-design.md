# 统一归档投影与 UI E2E 门禁设计

## 1. 背景与目标

当前 canonical `code-spec` 工作流在归档时需要同时维护模块级规范、模块关系、路由投影、全工程业务注册表和验证连接快照。归档结果必须是一个一致的、可恢复的状态，不能出现 `spec.md` 已更新但 `business.yaml` 或 `interface.yaml` 尚未更新的半完成状态。

本设计的目标是：

- 统一所有 canonical Change 的归档投影路径；
- 保证每个受影响模块拥有 `spec.md`、`interface.yaml` 和 `api.yaml`；
- 明确每个文件的唯一权威内容和派生关系；
- 对 UI Change 在归档时重新启动真实工程并执行浏览器 E2E；
- 以可恢复事务提交所有 Current Specification 和全局注册文件；
- 不生成 `test-cases.md` 或静态流程图文件。

本设计只适用于 canonical `code-spec` 工作流。旧 generic schema 和 slug Change 归档路径保留为兼容、迁移用途，不纳入新的三件套约束。

## 2. 已确认的决策

### 2.1 统一归档投影

所有 canonical Change 通过同一个归档事务生成模块投影，并更新全局投影。proposal Change 和 current-spec Change 不再拥有两套最终文件语义。

### 2.2 UI Change 判定

当 `metadata.yaml` 中：

```yaml
impact:
  affected_areas:
    - ui
```

包含 `ui` 时，该 Change 被视为 UI Change。

### 2.3 UI 归档策略

采用 A 方案：归档时重新启动真实工程并重新执行浏览器 E2E。仅有历史成功证据不能替代当前环境检查。

### 2.4 文件缺失策略

- 缺少已有模块的 `interface.yaml` 时默认阻止归档，避免静默丢失跨模块关系；
- 新注册且明确没有关系的模块可以生成空的 `interface.yaml`；
- 缺少 `api.yaml` 时由 `interface.yaml` 自动派生生成；
- 缺少 `spec.md` 时，只有 Change 提供完整且可验证的目标规范时才允许创建。

## 3. 文件契约

### 3.1 模块规范三件套

每个受影响模块的目录为：

```text
codespec/specs/<MOD-ID>/
├── spec.md
├── interface.yaml
└── api.yaml
```

`spec.md` 是 Requirement、Scenario、可读测试用例和当前工程文件的唯一规范来源，具体包含：

- Requirement；
- Scenario 及 `GIVEN / WHEN / THEN / ERROR`；
- 可读测试用例；
- 最近一次验证摘要；
- 当前模块工程文件、作用和关联 Requirement / Scenario / Test Case ID。

不生成或保留独立的 `test-cases.md`。

`interface.yaml` 是跨模块关系的权威来源。关系包括 HTTP 和 Event 关系，以及验证关系所需的行为语义。每条关系必须在两个端点模块中镜像保存，两个镜像内容一致。

`api.yaml` 是由全部 `interface.yaml` 派生的模块路由投影，只允许包含：

- 路由路径；
- 输入业务模块编号；
- 输出业务模块编号。

它不得保存 HTTP 方法、请求数据、响应数据、错误信息或模块名称。

### 3.2 全局文件

`business.yaml` 继续作为全工程业务模块注册表。归档事务根据完整关系图重新计算并更新每个模块的：

- `inputs`；
- `outputs`；
- `relatedModules`。

`configuration.yaml` 保存 CodeSpec 验证使用的服务连接快照、端点或端点指纹、路由绑定和配置来源。它不是项目运行时配置来源，归档不得把它当作应用运行时配置写入或注入。

`design.md` 只记录目标、非目标、范围、取舍、风险和迁移决策。它通过 Requirement、Scenario、Task 等稳定 ID 引用 `spec.md`，不得重复描述行为规范、测试步骤或工程文件内容。

### 3.3 动态流程图

全工程流程图由运行时读取所有模块的 `interface.yaml` 汇总生成。系统不保存独立的 SVG、PNG、Mermaid 或其他图文件；图文件不能成为归档成功的必要产物。

## 4. 组件与数据流

统一归档入口的处理顺序为：

```text
codespec archive <CHG-ID>
        ↓
preflightArchive
        ├── 读取并校验 Change 产物
        ├── 校验 Current Specification 和追踪关系
        ├── 合并 Requirement、关系、路由和配置增量
        ├── 生成模块三件套和全局投影
        └── UI Change 启动工程并执行浏览器 E2E
        ↓
commitArchive
        ├── 写入 Current Specification
        ├── 写入 business.yaml
        ├── 写入 configuration.yaml
        ├── 更新 changes/index.yaml
        ├── 写入 archive/changes/<CHG-ID>
        └── 删除活动 Change
```

组件职责：

- `archive-preflight`：读取输入、执行所有门禁、构造不可变的归档计划；
- `current-archive-merge`：合并模块注册、关系、配置和 Requirement 增量；
- `projection-builder`：从合并后的状态生成 `spec.md`、`interface.yaml`、`api.yaml`、`business.yaml` 和 `configuration.yaml`；
- `current-spec-graph`：从所有 `interface.yaml` 生成内存关系图、API 投影和业务派生字段；
- `archive-transaction`：负责快照、提交、恢复和活动 Change 清理。

生成器应尽量设计为纯函数：相同的当前输入、Change 增量和验证结果必须产生相同的投影内容。输出应进行稳定排序，避免无语义的文件抖动。

## 5. UI E2E 归档门禁

UI Change 的 `tasks.yaml.verificationPlan` 必须提供可执行的启动和浏览器验证信息：

```yaml
verificationPlan:
  testCase: MOD-001-REQ-001-SCN-001-TC-E2E-01
  runner: playwright
  startup: npm run dev -- --host 127.0.0.1
  command: npm run test:e2e
  profile: local
  services:
    - web
  prepare: npm run e2e:prepare
  cleanup: npm run e2e:cleanup
```

UI 归档预检必须：

1. 执行 `prepare`；
2. 启动真实工程并等待 `configuration.yaml` 声明的服务和路由就绪；
3. 启动浏览器并执行 E2E 命令；
4. 确认命令成功、浏览器可用且覆盖目标 Test Case；
5. 无论成功或失败都执行 `cleanup`；
6. 将本次执行证据纳入归档后的 `verification.yaml`，并更新 `spec.md` 的最近验证摘要。

启动失败、超时、服务未就绪、浏览器不可用、E2E 失败或清理失败都必须阻止归档。归档提交前的运行阶段不得更新 Current Specification；验证结果应先保存在事务待提交内容中。

非 UI Change 仍需满足普通 Requirement、Task、Verification、Build、Lint 和追踪性门禁，但不强制启动工程和浏览器 E2E。

## 6. 事务、并发与失败恢复

归档事务在提交前计算全部目标文件，并保存当前内容快照。提交范围至少包括：

- 受影响模块的 `codespec/specs/<MOD-ID>/`；
- `codespec/business.yaml`；
- `codespec/configuration.yaml`；
- `codespec/changes/index.yaml`；
- `codespec/archive/changes/<CHG-ID>/`；
- `codespec/archive/README.md`；
- `codespec/archive/history.yaml`；
- 活动 Change 目录的删除操作。

提交时使用 archive lock 和可恢复事务日志。提交前重新检查 Change metadata、Change index、Current Specification 和关系输入是否仍与预检快照一致；发现并发修改时直接失败并保留活动 Change。

任何写入步骤失败时：

- 不保留半完成的模块投影；
- 不删除活动 Change；
- 恢复已替换的全局文件；
- 保留必要的恢复日志或备份，并输出恢复路径。

成功提交后，临时 stage、backup、lock 和 transaction journal 清理。事务恢复目录不属于永久归档产物。

## 7. 验证计划

### 单元测试

- `spec.md` 解析 Requirement、Scenario、测试用例、验证摘要和工程文件；
- 禁止 `test-cases.md` 作为归档产物；
- `interface.yaml` schema、关系双端镜像和关系 ID 唯一性；
- `api.yaml` 派生内容、字段白名单和稳定排序；
- `business.yaml` 的输入、输出、关联模块与关系图一致；
- `configuration.yaml` 的来源、端点指纹和路由绑定校验；
- `design.md` 稳定 ID 引用和行为内容重复检查；
- 缺少已有模块 `interface.yaml` 时 fail closed；
- 新模块无关系时生成空 `interface.yaml`。

### 集成测试

- canonical Change 归档成功后生成三件套和全局文件；
- proposal Change 与 current-spec Change 得到相同的最终文件契约；
- UI Change 成功启动工程并通过浏览器 E2E 后才允许提交；
- 启动失败、E2E 失败、超时、浏览器不可用和清理失败均不产生归档提交；
- 归档中途失败时完整回滚；
- 进程崩溃后由 transaction journal 恢复；
- 并发修改触发 archive conflict；
- 动态流程图从多个 `interface.yaml` 汇总，且不生成静态图文件。

### 文档与迁移检查

- 更新用户手册、命令参考和 schema 模板，删除“归档不创建归档副本”等与实现不一致的描述；
- 明确 canonical `CHG-ID` 路径和旧 slug/generic 路径边界；
- 提供缺少 `interface.yaml` 的已有项目迁移或初始化指引；
- 确认 `configuration.yaml` 的验证快照语义不会被误解为运行时配置。

## 8. 非目标

- 不在本 Change 中改造旧 generic schema 的全部历史行为；
- 不生成独立测试用例文件；
- 不保存静态全工程流程图；
- 不把 CodeSpec 验证配置写入应用运行时配置；
- 不允许归档事务之外的独立命令修改 Current Specification。
