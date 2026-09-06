/**
 * CodeBuddy Command Adapter
 *
 * Formats commands for CodeBuddy following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * CodeBuddy adapter for command generation.
 * File path: .codebuddy/commands/codespec/<id>.md
 * Frontmatter: name, description, argument-hint
 */
export const codebuddyAdapter: ToolCommandAdapter = {
  toolId: 'codebuddy',

  getFilePath(commandId: string): string {
    return path.join('.codebuddy', 'commands', 'codespec', `${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
name: ${escapeYamlValue(content.name)}
description: ${escapeYamlValue(content.description)}
argument-hint: "[command arguments]"
---

${content.body}
`;
  },
};
