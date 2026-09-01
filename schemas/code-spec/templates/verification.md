# 验证证据
<!-- GIVEN 基线 WHEN 执行验证 THEN 记录 fresh 结果。 -->
<!-- 每次 VERIFY 都重新执行命令，不复用过期输出。 -->
| Requirement ID | Scenario ID | 命令 | Exit status | 结果摘要 | 时间 |
| --- | --- | --- | ---: | --- | --- |
| MOD-###-REQ-### | SC-## | `pnpm test` | 0 | 中文摘要 | YYYY-MM-DDThh:mm:ssZ |
## RED → GREEN
- RED 命令与失败原因：
- GREEN 命令与通过结果：
- 回归测试：
## Gate
- [ ] Requirements fresh verified
- [ ] tests passed
- [ ] build passed
- [ ] lint passed
- [ ] 明确执行 archive，不自动归档
