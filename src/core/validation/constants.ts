/**
 * Validation threshold constants
 */

// Minimum character lengths
export const MIN_WHY_SECTION_LENGTH = 50;
export const MIN_PURPOSE_LENGTH = 50;

// Maximum character/item limits
export const MAX_WHY_SECTION_LENGTH = 1000;
export const MAX_REQUIREMENT_TEXT_LENGTH = 500;
export const MAX_DELTAS_PER_CHANGE = 10;

// The Purpose `openspec archive` writes into a main spec it creates when the
// delta introduced the capability without a usable `## Purpose`. Named here, and
// composed from these two halves at the write site, so validation recognises the
// placeholder through the same definition that produces it: a second, hand-copied
// spelling would stop matching the day the wording changed, and a check that
// matches nothing looks exactly like a check that found nothing.
export const PURPOSE_PLACEHOLDER_PREFIX = 'TBD - created by archiving change ';
export const PURPOSE_PLACEHOLDER_SUFFIX = '. Update Purpose after archive.';

// Validation messages
export const VALIDATION_MESSAGES = {
  // Required content
  SCENARIO_EMPTY: 'Scenario 文本不能为空',
  REQUIREMENT_EMPTY: 'Requirement 文本不能为空',
  REQUIREMENT_NO_SHALL: 'Requirement 必须包含 SHALL 或 MUST 关键字',
  REQUIREMENT_NO_SCENARIOS: 'Requirement 至少需要一个 Scenario',
  SPEC_NAME_EMPTY: 'Spec 名称不能为空',
  SPEC_PURPOSE_EMPTY: 'Purpose 部分不能为空',
  SPEC_NO_REQUIREMENTS: 'Spec 至少需要一个 Requirement',
  CHANGE_NAME_EMPTY: 'Change 名称不能为空',
  CHANGE_WHY_TOO_SHORT: `Why 部分至少需要 ${MIN_WHY_SECTION_LENGTH} 个字符`,
  CHANGE_WHY_TOO_LONG: `Why 部分不应超过 ${MAX_WHY_SECTION_LENGTH} 个字符`,
  CHANGE_WHAT_EMPTY: 'What Changes 部分不能为空',
  CHANGE_NO_DELTAS: 'Change 至少需要一个 delta',
  CHANGE_SKIP_SPECS_CONFLICT:
    '已在 .openspec.yaml 中设置 skip_specs，但 specs/ 下仍存在 Spec 文件。请移除 skip_specs 或删除 delta Spec 文件',
  CHANGE_SKIP_SPECS_ACCEPTED:
    '已在 .openspec.yaml 中设置 skip_specs：Change 声明不包含 Spec 层行为变更，接受零个 delta',
  CHANGE_SKIP_SPECS_INVALID_METADATA:
    '已设置 skip_specs，但 .openspec.yaml 不是有效的 Change 元数据，因此不会采用该标记。请修复元数据',
  CHANGE_TOO_MANY_DELTAS: `包含超过 ${MAX_DELTAS_PER_CHANGE} 个 delta，建议拆分 Change`,
  DELTA_SPEC_EMPTY: 'Spec 名称不能为空',
  DELTA_DESCRIPTION_EMPTY: 'Delta 描述不能为空',
  
  // Warnings
  PURPOSE_TOO_BRIEF: `Purpose 部分过短（少于 ${MIN_PURPOSE_LENGTH} 个字符）`,
  PURPOSE_IS_PLACEHOLDER:
    'Purpose 部分仍是占位内容，而不是实际编写的 Purpose（可能是 `openspec archive` 为新 capability 写入的句子，或遗留的 `TBD`/`TODO` 标记）。请直接编辑主 Spec，改为说明 capability 的用途：delta 中的 `## Purpose` 只会在创建 capability 时读取，不能替代主 Spec 中的 Purpose。',
  REQUIREMENT_TOO_LONG: `Requirement 文本过长（超过 ${MAX_REQUIREMENT_TEXT_LENGTH} 个字符），建议拆分。`,
  DELTA_DESCRIPTION_TOO_BRIEF: 'Delta 描述过短',
  DELTA_MISSING_REQUIREMENTS: 'Delta 应包含 Requirements',
  
  // Guidance snippets (appended to primary messages for remediation)
  GUIDE_NO_DELTAS:
    '未找到 delta。请确认 Change 包含 specs/ 目录和 capability 子目录（例如 specs/http-server/spec.md），其中的 .md 文件使用 delta 标题（## ADDED/MODIFIED/REMOVED/RENAMED Requirements），且每个 Requirement 至少包含一个 "#### Scenario:" 块。如果 Change 有意不修改 Spec（纯重构、工具或文档），请在 Change 的 .openspec.yaml 中设置 "skip_specs: true"。提示：运行 "openspec change show <change-id> --json --deltas-only" 查看解析后的 delta。',
  GUIDE_MISSING_SPEC_SECTIONS:
    '缺少必需部分。应包含标题："## Purpose" 和 "## Requirements"。示例：\n## Purpose\n[简要目的]\n\n## Requirements\n### Requirement: Clear requirement statement\nUsers SHALL ...\n\n#### Scenario: Descriptive name\n- **WHEN** ...\n- **THEN** ...',
  GUIDE_MISSING_CHANGE_SECTIONS:
    '缺少必需部分。应包含标题："## Why" 和 "## What Changes"。请在 specs/ 中使用 delta 标题记录变更。',
  GUIDE_SCENARIO_FORMAT:
    'Scenario 必须使用四级标题。请将项目列表转换为：\n#### Scenario: Short name\n- **WHEN** ...\n- **THEN** ...\n- **AND** ...',
} as const;
