/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import {
  getArchiveChangeSkillTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxRebaseCommandTemplate,
  getOpsxWorkflowCommandTemplate,
  getRebaseChangeSkillTemplate,
  getOpenSpecWorkflowSkillTemplate,
  withOpenSpecWorkflowGuidance,
  type SkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';
import { OPENSPEC_CLI_ALLOWED_TOOLS } from './allowed-tools.js';
import { normalizeWorkflowId, type PublicWorkflowId } from '../profiles.js';

/**
 * Skill template with directory name and workflow ID mapping.
 */
export interface SkillTemplateEntry {
  template: SkillTemplate;
  dirName: string;
  workflowId: string;
}

/**
 * Command template with ID mapping.
 */
export interface CommandTemplateEntry {
  template: ReturnType<typeof getOpsxWorkflowCommandTemplate>;
  id: string;
}

function normalizePublicFilter(workflowFilter?: readonly string[]): Set<PublicWorkflowId> | undefined {
  if (!workflowFilter) return undefined;
  return new Set(
    workflowFilter
      .map((workflow) => normalizeWorkflowId(workflow))
      .filter((workflow): workflow is PublicWorkflowId => workflow !== null)
  );
}

const CHINESE_USER_GUIDANCE = '## 中文用户体验约定\n\n所有面向用户的解释、提问、进度、总结和生成产物正文使用中文。命令名、选项名、路径、YAML/JSON key、schema 名称、稳定 ID、状态枚举和 DSL Token 保持英文，确保协议可以执行和解析。状态展示使用中文标签并在括号中保留英文协议值，例如“状态：分析（ANALYZE）”。';

const CHINESE_DESCRIPTIONS: Record<string, string> = {
  'openspec-workflow': '将 OpenSpec code-spec 工作流路由到 canonical Change 流程。',
  'openspec-rebase-change': '处理 STALE、多 Change 冲突和基线重建。',
  'openspec-archive-change': '校验完成的 Change 并归档。',
};

function localizeTemplateDescription(name: string, fallback: string): string {
  return CHINESE_DESCRIPTIONS[name] ?? fallback;
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const all: SkillTemplateEntry[] = [
    { template: getOpenSpecWorkflowSkillTemplate(), dirName: 'openspec-workflow', workflowId: 'workflow' },
    { template: getRebaseChangeSkillTemplate(), dirName: 'openspec-rebase-change', workflowId: 'rebase' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'openspec-archive-change', workflowId: 'archive' },
  ];

  const routed = all.map((entry) => ({
    ...entry,
    template: {
      ...entry.template,
      description: localizeTemplateDescription(entry.dirName, entry.template.description),
      instructions: `${CHINESE_USER_GUIDANCE}\n\n${entry.template.instructions}`,
    },
  }));
  const publicFilter = normalizePublicFilter(workflowFilter);
  return publicFilter
    ? routed.filter((entry) => publicFilter.has(entry.workflowId as PublicWorkflowId))
    : routed;
}

/**
 * Gets command templates with their IDs, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose id is in this array
 */
export function getCommandTemplates(workflowFilter?: readonly string[]): CommandTemplateEntry[] {
  const all: CommandTemplateEntry[] = [
    { template: getOpsxWorkflowCommandTemplate(), id: 'workflow' },
    { template: getOpsxRebaseCommandTemplate(), id: 'rebase' },
    { template: getOpsxArchiveCommandTemplate(), id: 'archive' },
  ];

  const localized = all.map(({ template, ...entry }) => ({
    ...entry,
    template: {
      ...template,
      description: localizeTemplateDescription(`openspec-${entry.id}`, template.description),
      content: `${CHINESE_USER_GUIDANCE}\n\n${template.content}`,
    },
  }));
  const publicFilter = normalizePublicFilter(workflowFilter);
  return publicFilter
    ? localized.filter((entry) => publicFilter.has(entry.id as PublicWorkflowId))
    : localized;
}

/**
 * Converts command templates to CommandContent array, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return contents whose id is in this array
 */
export function getCommandContents(workflowFilter?: readonly string[]): CommandContent[] {
  const commandTemplates = getCommandTemplates(workflowFilter);
  return commandTemplates.map(({ template, id }) => ({
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    body: withOpenSpecWorkflowGuidance(template.content),
  }));
}


/**
 * Generates skill file content with YAML frontmatter.
 *
 * @param template - The skill template
 * @param generatedByVersion - The OpenSpec version to embed in the file
 * @param transformInstructions - Optional callback to transform the instructions content
 */
export function generateSkillContent(
  template: SkillTemplate,
  generatedByVersion: string,
  transformInstructions?: (instructions: string) => string
): string {
  const instructions = transformInstructions
    ? transformInstructions(template.instructions)
    : template.instructions;

  return `---
name: ${template.name}
description: ${template.description}
allowed-tools: ${OPENSPEC_CLI_ALLOWED_TOOLS}
license: ${template.license || 'MIT'}
compatibility: ${template.compatibility || 'Requires openspec CLI.'}
metadata:
  author: ${template.metadata?.author || 'openspec'}
  version: "${template.metadata?.version || '1.0'}"
  generatedBy: "${generatedByVersion}"
---

${instructions}
`;
}
