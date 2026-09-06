/**
 * Bob Shell Command Adapter
 *
 * Formats commands for Bob Shell following its markdown specification.
 * Commands are stored in .bob/commands/ directory.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * Bob Shell adapter for command generation.
 * File path: .bob/commands/codespec-<id>.md
 * Frontmatter: description
 *
 * Bob uses the filename (minus .md) as the slash command name, so
 * codespec-propose.md → /codespec-propose. generateCommand rewrites the body's
 * command references to that form before this adapter formats it.
 */
export const bobAdapter: ToolCommandAdapter = {
  toolId: 'bob',

  getFilePath(commandId: string): string {
    return path.join('.bob', 'commands', `codespec-${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: ${escapeYamlValue(content.description)}
argument-hint: command arguments
---

${content.body}
`;
  },
};
