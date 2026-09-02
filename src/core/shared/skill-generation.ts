/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import {
  getExploreSkillTemplate,
  getNewChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getApplyChangeSkillTemplate,
  getUpdateChangeSkillTemplate,
  getFfChangeSkillTemplate,
  getSyncSpecsSkillTemplate,
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getVerifyChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxUpdateCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxVerifyCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxProposeCommandTemplate,
  getOpenSpecWorkflowSkillTemplate,
  getStageAdapterGuidance,
  getUnsupportedStageGuidance,
  withOpenSpecWorkflowGuidance,
  type SkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';
import { OPENSPEC_CLI_ALLOWED_TOOLS } from './allowed-tools.js';

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
  template: ReturnType<typeof getOpsxExploreCommandTemplate>;
  id: string;
}

const CHINESE_USER_GUIDANCE = '## 中文用户体验约定\n\n所有面向用户的解释、提问、进度、总结和生成产物正文使用中文。命令名、选项名、路径、YAML/JSON key、schema 名称、稳定 ID、状态枚举和 DSL Token 保持英文，确保协议可以执行和解析。状态展示使用中文标签并在括号中保留英文协议值，例如“状态：分析（ANALYZE）”。';

const CHINESE_DESCRIPTIONS: Record<string, string> = {
  'openspec-workflow': '将 OpenSpec code-spec 工作流路由到 canonical Change 流程。',
  'openspec-explore': '探索想法、调查问题并澄清需求。',
  'openspec-new-change': '按步骤创建 OpenSpec Change 并准备第一个产物。',
  'openspec-continue-change': '继续 OpenSpec Change，创建下一个产物。',
  'openspec-apply-change': '根据 OpenSpec Change 中的任务实现变更。',
  'openspec-update-change': '修订已有 OpenSpec Change 的规划产物并保持一致。',
  'openspec-ff-change': '快速生成实现所需的全部 OpenSpec 产物。',
  'openspec-sync-specs': '将 Change 中的 delta Spec 同步到主 Spec。',
  'openspec-archive-change': '校验完成的 Change 并归档。',
  'openspec-bulk-archive-change': '批量校验并归档已完成的 Change。',
  'openspec-verify-change': '验证实现是否符合 Change 产物。',
  'openspec-onboard': '帮助新成员了解 OpenSpec 工作流。',
  'openspec-propose': '一次性提出 Change 并生成完整规划产物。',
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
    { template: getExploreSkillTemplate(), dirName: 'openspec-explore', workflowId: 'explore' },
    { template: getNewChangeSkillTemplate(), dirName: 'openspec-new-change', workflowId: 'new' },
    { template: getContinueChangeSkillTemplate(), dirName: 'openspec-continue-change', workflowId: 'continue' },
    { template: getApplyChangeSkillTemplate(), dirName: 'openspec-apply-change', workflowId: 'apply' },
    { template: getUpdateChangeSkillTemplate(), dirName: 'openspec-update-change', workflowId: 'update' },
    { template: getFfChangeSkillTemplate(), dirName: 'openspec-ff-change', workflowId: 'ff' },
    { template: getSyncSpecsSkillTemplate(), dirName: 'openspec-sync-specs', workflowId: 'sync' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'openspec-archive-change', workflowId: 'archive' },
    { template: getBulkArchiveChangeSkillTemplate(), dirName: 'openspec-bulk-archive-change', workflowId: 'bulk-archive' },
    { template: getVerifyChangeSkillTemplate(), dirName: 'openspec-verify-change', workflowId: 'verify' },
    { template: getOnboardSkillTemplate(), dirName: 'openspec-onboard', workflowId: 'onboard' },
    { template: getOpsxProposeSkillTemplate(), dirName: 'openspec-propose', workflowId: 'propose' },
  ];

  const stageByWorkflow: Record<string, import('../templates/workflows/openspec-workflow.js').WorkflowStage> = { new: 'new', continue: 'continue', propose: 'propose', apply: 'apply', verify: 'verify', archive: 'archive', ff: 'ff' };
  const routed = all.map(entry => {
    const routedTemplate = entry.dirName === 'openspec-workflow' || entry.template.instructions.includes('## Canonical OpenSpec')
      ? entry.template
      : { ...entry.template, instructions: withOpenSpecWorkflowGuidance(`${stageByWorkflow[entry.workflowId] ? getStageAdapterGuidance(stageByWorkflow[entry.workflowId]) : getUnsupportedStageGuidance(entry.workflowId)}\n\n${entry.template.instructions}`) };
    return {
      ...entry,
      template: {
        ...routedTemplate,
        description: localizeTemplateDescription(entry.dirName, routedTemplate.description),
        instructions: `${CHINESE_USER_GUIDANCE}\n\n${routedTemplate.instructions}`,
      },
    };
  });
  if (!workflowFilter) return routed;

  const filterSet = new Set(workflowFilter);
  return routed.filter(entry => filterSet.has(entry.workflowId));
}

/**
 * Gets command templates with their IDs, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose id is in this array
 */
export function getCommandTemplates(workflowFilter?: readonly string[]): CommandTemplateEntry[] {
  const all: CommandTemplateEntry[] = [
    { template: getOpsxExploreCommandTemplate(), id: 'explore' },
    { template: getOpsxNewCommandTemplate(), id: 'new' },
    { template: getOpsxContinueCommandTemplate(), id: 'continue' },
    { template: getOpsxApplyCommandTemplate(), id: 'apply' },
    { template: getOpsxUpdateCommandTemplate(), id: 'update' },
    { template: getOpsxFfCommandTemplate(), id: 'ff' },
    { template: getOpsxSyncCommandTemplate(), id: 'sync' },
    { template: getOpsxArchiveCommandTemplate(), id: 'archive' },
    { template: getOpsxBulkArchiveCommandTemplate(), id: 'bulk-archive' },
    { template: getOpsxVerifyCommandTemplate(), id: 'verify' },
    { template: getOpsxOnboardCommandTemplate(), id: 'onboard' },
    { template: getOpsxProposeCommandTemplate(), id: 'propose' },
  ];

  const localized = all.map(({ template, ...entry }) => ({
    ...entry,
    template: {
      ...template,
      description: localizeTemplateDescription(`openspec-${entry.id}`, template.description),
      content: `${CHINESE_USER_GUIDANCE}\n\n${template.content}`,
    },
  }));
  if (!workflowFilter) return localized;

  const filterSet = new Set(workflowFilter);
  return localized.filter(entry => filterSet.has(entry.id));
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
