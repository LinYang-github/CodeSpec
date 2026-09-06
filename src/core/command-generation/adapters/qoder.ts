/**
 * Qoder Command Adapter
 *
 * Formats commands for Qoder following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue, formatTagsArray } from '../yaml.js';

/**
 * Qoder adapter for command generation.
 * File path: .qoder/commands/codespec/<id>.md
 * Frontmatter: name, description, category, tags
 */
export const qoderAdapter: ToolCommandAdapter = {
  toolId: 'qoder',

  getFilePath(commandId: string): string {
    return path.join('.qoder', 'commands', 'codespec', `${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
name: ${escapeYamlValue(content.name)}
description: ${escapeYamlValue(content.description)}
category: ${escapeYamlValue(content.category)}
tags: ${formatTagsArray(content.tags)}
---

${content.body}
`;
  },
};
