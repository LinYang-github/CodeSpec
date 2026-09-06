# 验证证据
<!-- GIVEN 基线 WHEN 执行验证 THEN 记录 fresh 结果。 -->
<!-- 本文档由 CodeSpec 生成。每次 VERIFY 都重新执行命令，不复用过期输出。 -->

## 验证结果

- 变更：`CHG-YYYYMMDD-NNN`
- 状态：**PASS**
- 修订：`1`
- 验证时间：`YYYY-MM-DDTHH:mm:ss.sssZ`
- Baseline：`<sha256>`
- Receipt：`<sha256>`

## Requirement 覆盖

| Requirement ID |
| --- |
| `MOD-001-REQ-001` |

## Scenario 覆盖

| Scenario ID |
| --- |
| `SCN-001` |

每个 Scenario 都必须有已填写且可验证的 `ERROR` 处理结果。`ERROR` 缺失或为空时，必须人工补写；Verification 不得通过，Change 不得归档。

## 命令记录

| 命令 | 类型 | Exit status | 结果摘要 | 时间 |
| --- | --- | ---: | --- | --- |
| `pnpm test:unit` | unit | 0 | 中文摘要 | `2026-09-01T00:00:00Z` |
| `pnpm typecheck` | typecheck | 0 | 中文摘要 | `2026-09-01T00:00:00Z` |
| `pnpm build` | build | 0 | 中文摘要 | `2026-09-01T00:00:00Z` |
| `pnpm lint` | lint | 0 | 中文摘要 | `2026-09-01T00:00:00Z` |

Level 2 还必须记录 `bdd` 和 `integration`；Level 3 只在 `affected_areas` 声明对应风险时记录 `security`、`migration` 或 `performance`。影响既有 Current Specification 时，必须记录覆盖旧、新 Requirement / Scenario 的 `archive-regression`。

## Gate

- ✅ Requirements fresh verified
- ✅ unit tests passed
- ✅ typecheck passed
- ✅ build passed
- ✅ lint passed
- ✅ 每个 Scenario 的 ERROR 必须已填写
- ❌ 任一 ERROR 缺失或为空：必须人工补写，Verification 不得通过，Change 不得归档
- 明确执行 archive，不自动归档

## 机器校验数据

下面的 YAML 是归档校验使用的完整证据，请勿手工修改。

```yaml
schema_version: 1
change_id: CHG-YYYYMMDD-NNN
verified_at: YYYY-MM-DDTHH:mm:ss.sssZ
revision: 1
status: PASS
requirement_ids:
  - MOD-001-REQ-001
scenario_ids:
  - SCN-001
baseline_identity: <sha256>
receipt: <sha256>
commands:
  - command: pnpm test:unit
    kind: unit
    exit_code: 0
    output_summary: 中文摘要
    started_at: 2026-09-01T00:00:00Z
    finished_at: 2026-09-01T00:00:00Z
  - command: pnpm typecheck
    kind: typecheck
    exit_code: 0
    output_summary: 中文摘要
    started_at: 2026-09-01T00:00:00Z
    finished_at: 2026-09-01T00:00:00Z
```
