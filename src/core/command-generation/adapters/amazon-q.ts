/**
 * Amazon Q Developer Command Adapter
 *
 * Formats commands for Amazon Q Developer following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * Amazon Q adapter for command generation.
 * File path: .amazonq/prompts/codespec-<id>.md
 * Frontmatter: description
 *
 * Amazon Q surfaces these files as its prompt library rather than as slash
 * commands: the user types `@codespec-propose`, not `/codespec-propose`.
 * https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-prompts.html
 */
export const amazonQAdapter: ToolCommandAdapter = {
  toolId: 'amazon-q',

  getFilePath(commandId: string): string {
    return path.join('.amazonq', 'prompts', `codespec-${commandId}.md`);
  },

  invocationPrefix: '@',

  formatFile(content: CommandContent): string {
    return `---
description: ${escapeYamlValue(content.description)}
---

${content.body}
`;
  },
};
