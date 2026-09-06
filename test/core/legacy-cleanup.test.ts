import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  detectLegacyArtifacts,
  detectLegacyConfigFiles,
  detectLegacySlashCommands,
  detectLegacyStructureFiles,
  getCodexPromptDir,
  hasCodeSpecMarkers,
  isOnlyCodeSpecContent,
  removeMarkerBlock,
  cleanupLegacyArtifacts,
  formatDeferredGlobalPromptSummary,
  formatCleanupSummary,
  formatDetectionSummary,
  formatProjectMdMigrationHint,
  getToolsFromLegacyArtifacts,
  omitToolLegacyArtifacts,
  LEGACY_CONFIG_FILES,
  LEGACY_GLOBAL_SLASH_COMMAND_PATHS,
  LEGACY_SLASH_COMMAND_PATHS,
} from '../../src/core/legacy-cleanup.js';
import { CODESPEC_MARKERS } from '../../src/core/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/registry.js';
import { resolveCommandSurfaceCapability } from '../../src/core/command-surface.js';
import { PUBLIC_WORKFLOWS } from '../../src/core/profiles.js';

describe('legacy-cleanup', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-legacy-test-'));
    process.env.CODEX_HOME = path.join(testDir, 'codex-home');
    // Create codespec directory structure
    await fs.mkdir(path.join(testDir, 'codespec'), { recursive: true });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('hasCodeSpecMarkers', () => {
    it('should return true when both markers are present', () => {
      const content = `Some content
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}
More content`;
      expect(hasCodeSpecMarkers(content)).toBe(true);
    });

    it('should return false when start marker is missing', () => {
      const content = `Some content
CodeSpec content
${CODESPEC_MARKERS.end}`;
      expect(hasCodeSpecMarkers(content)).toBe(false);
    });

    it('should return false when end marker is missing', () => {
      const content = `${CODESPEC_MARKERS.start}
CodeSpec content
Some content`;
      expect(hasCodeSpecMarkers(content)).toBe(false);
    });

    it('should return false when no markers are present', () => {
      const content = 'Plain content without markers';
      expect(hasCodeSpecMarkers(content)).toBe(false);
    });
  });

  describe('isOnlyCodeSpecContent', () => {
    it('should return true when content is only markers and whitespace outside', () => {
      const content = `${CODESPEC_MARKERS.start}
CodeSpec content here
${CODESPEC_MARKERS.end}`;
      expect(isOnlyCodeSpecContent(content)).toBe(true);
    });

    it('should return true with whitespace before and after markers', () => {
      const content = `

${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}

`;
      expect(isOnlyCodeSpecContent(content)).toBe(true);
    });

    it('should return false when content exists before markers', () => {
      const content = `User content here
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`;
      expect(isOnlyCodeSpecContent(content)).toBe(false);
    });

    it('should return false when content exists after markers', () => {
      const content = `${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}
User content here`;
      expect(isOnlyCodeSpecContent(content)).toBe(false);
    });

    it('should return false when markers are missing', () => {
      const content = 'Plain content without markers';
      expect(isOnlyCodeSpecContent(content)).toBe(false);
    });

    it('should return false when end marker comes before start marker', () => {
      const content = `${CODESPEC_MARKERS.end}
Content
${CODESPEC_MARKERS.start}`;
      expect(isOnlyCodeSpecContent(content)).toBe(false);
    });
  });

  describe('removeMarkerBlock', () => {
    it('should remove marker block and preserve content before', () => {
      const content = `User content before
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`;
      const result = removeMarkerBlock(content);
      expect(result).toBe('User content before\n');
      expect(result).not.toContain(CODESPEC_MARKERS.start);
      expect(result).not.toContain(CODESPEC_MARKERS.end);
    });

    it('should remove marker block and preserve content after', () => {
      const content = `${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}
User content after`;
      const result = removeMarkerBlock(content);
      expect(result).toBe('User content after\n');
    });

    it('should remove marker block and preserve content before and after', () => {
      const content = `User content before
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}
User content after`;
      const result = removeMarkerBlock(content);
      expect(result).toContain('User content before');
      expect(result).toContain('User content after');
      expect(result).not.toContain(CODESPEC_MARKERS.start);
    });

    it('should clean up double blank lines', () => {
      const content = `Line 1


${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}


Line 2`;
      const result = removeMarkerBlock(content);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('should return empty string when only markers remain', () => {
      const content = `${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`;
      const result = removeMarkerBlock(content);
      expect(result).toBe('');
    });

    it('should return original content when markers are missing', () => {
      const content = 'Plain content without markers';
      const result = removeMarkerBlock(content);
      // When no markers found, content is returned trimmed (no trailing newline added)
      expect(result).toBe('Plain content without markers');
    });

    it('should return original content when markers are in wrong order', () => {
      const content = `${CODESPEC_MARKERS.end}
Content
${CODESPEC_MARKERS.start}`;
      const result = removeMarkerBlock(content);
      expect(result).toContain(CODESPEC_MARKERS.end);
      expect(result).toContain(CODESPEC_MARKERS.start);
    });

    it('should ignore inline mentions of markers and only remove actual block', () => {
      const content = `Intro referencing ${CODESPEC_MARKERS.start} and ${CODESPEC_MARKERS.end} inline.

${CODESPEC_MARKERS.start}
Managed content here
${CODESPEC_MARKERS.end}
After content`;
      const result = removeMarkerBlock(content);
      // Inline mentions preserved
      expect(result).toContain('Intro referencing');
      expect(result).toContain(CODESPEC_MARKERS.start);
      expect(result).toContain(CODESPEC_MARKERS.end);
      // Managed content removed
      expect(result).not.toContain('Managed content here');
      expect(result).toContain('After content');
    });
  });

  describe('detectLegacyConfigFiles', () => {
    it('should detect CLAUDE.md with CodeSpec markers and put in update list', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`);

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toContain('CLAUDE.md');
      // Config files are NEVER deleted, always updated (markers removed)
      expect(result.filesToUpdate).toContain('CLAUDE.md');
    });

    it('should detect files with mixed content and put in update list', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `User instructions here
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`);

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toContain('CLAUDE.md');
      expect(result.filesToUpdate).toContain('CLAUDE.md');
    });

    it('should not detect files without CodeSpec markers', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, 'Plain instructions without markers');

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).not.toContain('CLAUDE.md');
    });

    it('should detect multiple config files', async () => {
      // Create multiple config files with markers
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `${CODESPEC_MARKERS.start}\nContent\n${CODESPEC_MARKERS.end}`);
      await fs.writeFile(path.join(testDir, 'CLINE.md'), `${CODESPEC_MARKERS.start}\nContent\n${CODESPEC_MARKERS.end}`);
      await fs.writeFile(path.join(testDir, 'QODER.md'), `${CODESPEC_MARKERS.start}\nContent\n${CODESPEC_MARKERS.end}`);

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toHaveLength(3);
      expect(result.allFiles).toContain('CLAUDE.md');
      expect(result.allFiles).toContain('CLINE.md');
      expect(result.allFiles).toContain('QODER.md');
      // All should be in update list, none deleted
      expect(result.filesToUpdate).toHaveLength(3);
    });

    it('should handle non-existent files gracefully', async () => {
      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toHaveLength(0);
      expect(result.filesToUpdate).toHaveLength(0);
    });
  });

  describe('detectLegacySlashCommands', () => {
    it('should detect legacy Claude slash command directory', async () => {
      const dirPath = path.join(testDir, '.claude', 'commands', 'codespec');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'proposal.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toContain('.claude/commands/codespec');
    });

    it('should detect legacy Cursor slash command files', async () => {
      const dirPath = path.join(testDir, '.cursor', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'codespec-proposal.md'), 'content');
      await fs.writeFile(path.join(dirPath, 'codespec-apply.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.cursor/commands/codespec-proposal.md');
      expect(result.files).toContain('.cursor/commands/codespec-apply.md');
    });

    it('should detect legacy Windsurf workflow files', async () => {
      const dirPath = path.join(testDir, '.windsurf', 'workflows');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'codespec-proposal.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.windsurf/workflows/codespec-proposal.md');
    });

    it('should detect multiple tool directories and files', async () => {
      // Create directory-based
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'codespec'), { recursive: true });
      await fs.mkdir(path.join(testDir, '.qoder', 'commands', 'codespec'), { recursive: true });

      // Create file-based
      await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.cursor', 'commands', 'codespec-proposal.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toContain('.claude/commands/codespec');
      expect(result.directories).toContain('.qoder/commands/codespec');
      expect(result.files).toContain('.cursor/commands/codespec-proposal.md');
    });

    it('should not detect non-codespec files', async () => {
      const dirPath = path.join(testDir, '.cursor', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'other-command.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).not.toContain('.cursor/commands/other-command.md');
    });

    it('should handle non-existent directories gracefully', async () => {
      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toHaveLength(0);
      expect(result.files).toHaveLength(0);
    });

    it('should detect TOML-based slash commands for Qwen', async () => {
      const dirPath = path.join(testDir, '.qwen', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'codespec-proposal.toml'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.qwen/commands/codespec-proposal.toml');
    });

    it('should detect deprecated opsx TOML commands for Qwen', async () => {
      const dirPath = path.join(testDir, '.qwen', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'opsx-explore.toml'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.qwen/commands/opsx-explore.toml');
    });

    it('should not detect new Markdown commands for Qwen as legacy', async () => {
      const dirPath = path.join(testDir, '.qwen', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'opsx-explore.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).not.toContain('.qwen/commands/opsx-explore.md');
    });

    it('should detect Continue prompt files', async () => {
      const dirPath = path.join(testDir, '.continue', 'prompts');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'codespec-apply.prompt'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.continue/prompts/codespec-apply.prompt');
    });

    it('should detect legacy OpenCode opsx-* command files', async () => {
      const dirPath = path.join(testDir, '.opencode', 'command');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'opsx-propose.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.opencode/command/opsx-propose.md');
    });

    it('should detect legacy OpenCode codespec-* command files', async () => {
      const dirPath = path.join(testDir, '.opencode', 'command');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'codespec-new.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.opencode/command/codespec-new.md');
    });

    it('should detect both opsx-* and codespec-* OpenCode command files', async () => {
      const dirPath = path.join(testDir, '.opencode', 'command');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'opsx-propose.md'), 'content');
      await fs.writeFile(path.join(dirPath, 'codespec-new.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.opencode/command/opsx-propose.md');
      expect(result.files).toContain('.opencode/command/codespec-new.md');
    });

    it('should detect legacy CoStrict command files without claiming their directory', async () => {
      const dirPath = path.join(testDir, '.cospec', 'codespec', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'codespec-proposal.md'), 'content');
      await fs.writeFile(path.join(dirPath, 'codespec-apply.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.cospec/codespec/commands/codespec-apply.md');
      expect(result.files).toContain('.cospec/codespec/commands/codespec-proposal.md');
      expect(result.directories).not.toContain('.cospec/codespec/commands');
    });

    it('should not report any file a current command adapter writes as a legacy artifact', async () => {
      // Codex is the only legacy tool id with no adapter, so it is the only
      // entry with no current output for this invariant to compare against.
      const withoutAdapter = Object.keys(LEGACY_SLASH_COMMAND_PATHS).filter(
        (toolId) => !CommandAdapterRegistry.has(toolId)
      );
      expect(withoutAdapter).toEqual(['codex']);

      const currentFiles = CommandAdapterRegistry.getAll().flatMap((adapter) =>
        PUBLIC_WORKFLOWS.map((workflowId) => adapter.getFilePath(workflowId))
      );
      expect(currentFiles.every((filePath) => !path.isAbsolute(filePath))).toBe(true);

      for (const relativePath of currentFiles) {
        const filePath = path.join(testDir, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, 'current command output');
      }

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toEqual([]);
      expect(result.directories).toEqual([]);
    });

    it('should not include managed global Codex prompt files in repo-local slash command detection', async () => {
      const promptDir = getCodexPromptDir();
      await fs.mkdir(promptDir, { recursive: true });
      await fs.writeFile(path.join(promptDir, 'opsx-explore.md'), 'legacy explore prompt');
      await fs.writeFile(path.join(promptDir, 'codespec-proposal.md'), 'managed');
      await fs.writeFile(path.join(promptDir, 'my-custom-prompt.md'), 'user');

      const result = await detectLegacySlashCommands(testDir);

      expect(result.files).not.toContain(path.join(promptDir, 'opsx-explore.md'));
      expect(result.files).not.toContain(path.join(promptDir, 'codespec-proposal.md'));
      expect(result.files).not.toContain(path.join(promptDir, 'my-custom-prompt.md'));
    });
  });

  describe('detectLegacyStructureFiles', () => {
    it('should detect codespec/AGENTS.md', async () => {
      const agentsPath = path.join(testDir, 'codespec', 'AGENTS.md');
      await fs.writeFile(agentsPath, '# AGENTS.md content');

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasCodeSpecAgents).toBe(true);
    });

    it('should detect codespec/project.md', async () => {
      const projectPath = path.join(testDir, 'codespec', 'project.md');
      await fs.writeFile(projectPath, '# Project content');

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasProjectMd).toBe(true);
    });

    it('should detect root AGENTS.md with CodeSpec markers', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`);

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasRootAgentsWithMarkers).toBe(true);
    });

    it('should not detect root AGENTS.md without markers', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, 'Plain content without markers');

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasRootAgentsWithMarkers).toBe(false);
    });

    it('should handle non-existent files gracefully', async () => {
      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasCodeSpecAgents).toBe(false);
      expect(result.hasProjectMd).toBe(false);
      expect(result.hasRootAgentsWithMarkers).toBe(false);
    });
  });

  describe('detectLegacyArtifacts', () => {
    it('should return hasLegacyArtifacts: false when nothing is found', async () => {
      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(false);
    });

    it('should return hasLegacyArtifacts: true when config files are found', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `${CODESPEC_MARKERS.start}\nContent\n${CODESPEC_MARKERS.end}`);

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.configFiles).toContain('CLAUDE.md');
    });

    it('should return hasLegacyArtifacts: true when slash commands are found', async () => {
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'codespec'), { recursive: true });

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.slashCommandDirs).toContain('.claude/commands/codespec');
    });

    it('should return hasLegacyArtifacts: true when codespec/AGENTS.md is found', async () => {
      await fs.writeFile(path.join(testDir, 'codespec', 'AGENTS.md'), 'content');

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.hasCodeSpecAgents).toBe(true);
    });

    it('should detect project.md for migration hint (it is preserved, not deleted)', async () => {
      await fs.writeFile(path.join(testDir, 'codespec', 'project.md'), 'content');

      const result = await detectLegacyArtifacts(testDir);
      // project.md triggers hasLegacyArtifacts to show migration hint
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.hasProjectMd).toBe(true);
    });

    it('should combine all detection results', async () => {
      // Create various legacy artifacts
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `${CODESPEC_MARKERS.start}\nContent\n${CODESPEC_MARKERS.end}`);
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'codespec'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'codespec', 'AGENTS.md'), 'content');
      await fs.writeFile(path.join(testDir, 'codespec', 'project.md'), 'content');

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.configFiles).toContain('CLAUDE.md');
      expect(result.slashCommandDirs).toContain('.claude/commands/codespec');
      expect(result.hasCodeSpecAgents).toBe(true);
      expect(result.hasProjectMd).toBe(true);
    });

    it('should detect allowlisted global Codex prompts separately from repo-local slash commands', async () => {
      const promptDir = getCodexPromptDir();
      await fs.mkdir(promptDir, { recursive: true });
      await fs.writeFile(path.join(promptDir, 'opsx-explore.md'), 'prompt generated by an older CodeSpec version');
      await fs.writeFile(path.join(promptDir, 'opsx-update.md'), 'legacy update prompt');
      await fs.writeFile(path.join(promptDir, 'opsx-review.md'), 'user');
      await fs.writeFile(path.join(promptDir, 'codespec-proposal.md'), 'managed');
      await fs.writeFile(path.join(promptDir, 'my-custom-prompt.md'), 'user');

      const result = await detectLegacyArtifacts(testDir);

      expect(result.globalSlashCommandFiles).toContain(path.join(promptDir, 'opsx-explore.md'));
      expect(result.globalSlashCommandFiles).toContain(path.join(promptDir, 'opsx-update.md'));
      expect(result.globalSlashCommandFiles).not.toContain(path.join(promptDir, 'opsx-review.md'));
      expect(result.globalSlashCommandFiles).not.toContain(path.join(promptDir, 'codespec-proposal.md'));
      expect(result.globalSlashCommandFiles).not.toContain(path.join(promptDir, 'my-custom-prompt.md'));
      expect(result.slashCommandFiles).not.toContain(path.join(promptDir, 'opsx-explore.md'));
    });

    it('should detect exact allowlisted global Codex filenames regardless of template revision', async () => {
      const promptDir = getCodexPromptDir();
      await fs.mkdir(promptDir, { recursive: true });
      await fs.writeFile(
        path.join(promptDir, 'opsx-explore.md'),
        '# custom explore prompt\n\nThis is not an CodeSpec generated Codex prompt.\n'
      );

      const result = await detectLegacyArtifacts(testDir);

      expect(result.globalSlashCommandFiles).toContain(path.join(promptDir, 'opsx-explore.md'));
    });
  });

  describe('cleanupLegacyArtifacts', () => {
    it('should remove markers from config files that have only CodeSpec content (never delete)', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `${CODESPEC_MARKERS.start}\nContent\n${CODESPEC_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      // Config files should NEVER be deleted, only have markers removed
      expect(result.deletedFiles).not.toContain('CLAUDE.md');
      expect(result.modifiedFiles).toContain('CLAUDE.md');
      // File should still exist
      await expect(fs.access(claudePath)).resolves.not.toThrow();
      // File should be empty or have markers removed
      const content = await fs.readFile(claudePath, 'utf-8');
      expect(content).not.toContain(CODESPEC_MARKERS.start);
      expect(content).not.toContain(CODESPEC_MARKERS.end);
    });

    it('should remove marker block from files with mixed content', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `User instructions
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.modifiedFiles).toContain('CLAUDE.md');
      const content = await fs.readFile(claudePath, 'utf-8');
      expect(content).toContain('User instructions');
      expect(content).not.toContain(CODESPEC_MARKERS.start);
    });

    it('should delete legacy slash command directories', async () => {
      const dirPath = path.join(testDir, '.claude', 'commands', 'codespec');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'proposal.md'), 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedDirs).toContain('.claude/commands/codespec');
      await expect(fs.access(dirPath)).rejects.toThrow();
      // Parent directory should still exist
      await expect(fs.access(path.join(testDir, '.claude', 'commands'))).resolves.not.toThrow();
    });

    it('should delete legacy slash command files', async () => {
      const dirPath = path.join(testDir, '.cursor', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      const filePath = path.join(dirPath, 'codespec-proposal.md');
      await fs.writeFile(filePath, 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain('.cursor/commands/codespec-proposal.md');
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should delete legacy CoStrict command files without emptying their directory', async () => {
      const dirPath = path.join(testDir, '.cospec', 'codespec', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      const legacyFile = path.join(dirPath, 'codespec-proposal.md');
      const currentFile = path.join(dirPath, 'opsx-propose.md');
      const userFile = path.join(dirPath, 'my-team-command.md');
      await fs.writeFile(legacyFile, 'content');
      await fs.writeFile(currentFile, 'content');
      await fs.writeFile(userFile, 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain('.cospec/codespec/commands/codespec-proposal.md');
      expect(result.deletedDirs).not.toContain('.cospec/codespec/commands');
      await expect(fs.access(legacyFile)).rejects.toThrow();
      await expect(fs.access(currentFile)).resolves.not.toThrow();
      await expect(fs.access(userFile)).resolves.not.toThrow();
    });

    it('should delete codespec/AGENTS.md', async () => {
      const agentsPath = path.join(testDir, 'codespec', 'AGENTS.md');
      await fs.writeFile(agentsPath, 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain('codespec/AGENTS.md');
      await expect(fs.access(agentsPath)).rejects.toThrow();
      // codespec directory should still exist
      await expect(fs.access(path.join(testDir, 'codespec'))).resolves.not.toThrow();
    });

    it('should NOT delete codespec/project.md', async () => {
      const projectPath = path.join(testDir, 'codespec', 'project.md');
      await fs.writeFile(projectPath, 'User project content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.projectMdNeedsMigration).toBe(true);
      expect(result.deletedFiles).not.toContain('codespec/project.md');
      await expect(fs.access(projectPath)).resolves.not.toThrow();
    });

    it('should handle root AGENTS.md with mixed content', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `User content
${CODESPEC_MARKERS.start}
CodeSpec content
${CODESPEC_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.modifiedFiles).toContain('AGENTS.md');
      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('User content');
      expect(content).not.toContain(CODESPEC_MARKERS.start);
    });

    it('should remove markers from root AGENTS.md even when only CodeSpec content (never delete)', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `${CODESPEC_MARKERS.start}\nCodeSpec content\n${CODESPEC_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      // Root AGENTS.md should NEVER be deleted, only have markers removed
      expect(result.deletedFiles).not.toContain('AGENTS.md');
      expect(result.modifiedFiles).toContain('AGENTS.md');
      // File should still exist
      await expect(fs.access(agentsPath)).resolves.not.toThrow();
    });

    it('should report errors without stopping cleanup', async () => {
      // Create a valid detection result with a non-existent file to simulate error
      const detection = {
        configFiles: ['NON_EXISTENT.md'],
        configFilesToUpdate: ['NON_EXISTENT.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const result = await cleanupLegacyArtifacts(testDir, detection);

      // Should not throw, but should record the error
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('NON_EXISTENT.md');
    });

    it('should remove allowlisted global Codex prompts and preserve unmanaged prompts', async () => {
      const promptDir = getCodexPromptDir();
      const managedPrompt = path.join(promptDir, 'opsx-apply.md');
      const customOpsxPrompt = path.join(promptDir, 'opsx-review.md');
      const legacyPrompt = path.join(promptDir, 'codespec-proposal.md');
      const unmanagedPrompt = path.join(promptDir, 'personal.md');
      await fs.mkdir(promptDir, { recursive: true });
      await fs.writeFile(managedPrompt, 'legacy apply prompt');
      await fs.writeFile(customOpsxPrompt, 'user');
      await fs.writeFile(legacyPrompt, 'managed');
      await fs.writeFile(unmanagedPrompt, 'user');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain(managedPrompt);
      expect(result.deletedFiles).not.toContain(legacyPrompt);
      expect(result.deletedFiles).not.toContain(customOpsxPrompt);
      await expect(fs.access(managedPrompt)).rejects.toThrow();
      await expect(fs.access(customOpsxPrompt)).resolves.not.toThrow();
      await expect(fs.access(legacyPrompt)).resolves.not.toThrow();
      await expect(fs.access(unmanagedPrompt)).resolves.not.toThrow();
    });

    it('should remove exact allowlisted global Codex filenames when their content differs', async () => {
      const promptDir = getCodexPromptDir();
      const customizedManagedName = path.join(promptDir, 'opsx-apply.md');
      await fs.mkdir(promptDir, { recursive: true });
      await fs.writeFile(
        customizedManagedName,
        '# customized legacy apply prompt\n'
      );

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain(customizedManagedName);
      await expect(fs.access(customizedManagedName)).rejects.toThrow();
    });

    it('should skip unmanaged global prompt paths in stale detection objects', async () => {
      const promptDir = getCodexPromptDir();
      const managedPrompt = path.join(promptDir, 'opsx-apply.md');
      const unmanagedPrompt = path.join(promptDir, 'personal.md');
      const outsidePrompt = path.join(testDir, 'other-codex-home', 'prompts', 'opsx-apply.md');
      await fs.mkdir(promptDir, { recursive: true });
      await fs.mkdir(path.dirname(outsidePrompt), { recursive: true });
      await fs.writeFile(managedPrompt, 'legacy apply prompt');
      await fs.writeFile(unmanagedPrompt, 'user');
      await fs.writeFile(outsidePrompt, 'outside configured Codex prompt directory');

      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [managedPrompt, unmanagedPrompt, outsidePrompt],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain(managedPrompt);
      expect(result.deletedFiles).not.toContain(unmanagedPrompt);
      expect(result.deletedFiles).not.toContain(outsidePrompt);
      expect(result.errors).toContain(`Skipped unmanaged global prompt ${unmanagedPrompt}`);
      expect(result.errors).toContain(`Skipped unmanaged global prompt ${outsidePrompt}`);
      await expect(fs.access(managedPrompt)).rejects.toThrow();
      await expect(fs.access(unmanagedPrompt)).resolves.not.toThrow();
      await expect(fs.access(outsidePrompt)).resolves.not.toThrow();
    });
  });

  describe('formatCleanupSummary', () => {
    it('should format deleted files', () => {
      const result = {
        deletedFiles: ['CLAUDE.md', 'CLINE.md'],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('旧文件清理完成：');
      expect(summary).toContain('✓ 已移除 CLAUDE.md');
      expect(summary).toContain('✓ 已移除 CLINE.md');
    });

    it('should format deleted directories', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: ['.claude/commands/codespec'],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('✓ 已移除 .claude/commands/codespec/（已由 CodeSpec skills 和 commands 替代）');
    });

    it('should format modified files', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: ['AGENTS.md'],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('✓ 已从 AGENTS.md 移除 CodeSpec 标记');
    });

    it('should include migration hint for project.md', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: true,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('需要你处理');
      expect(summary).toContain('codespec/project.md');
      expect(summary).toContain('config.yaml');
    });

    it('should include errors', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: ['Failed to delete CLAUDE.md: Permission denied'],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('清理期间发生错误：');
      expect(summary).toContain('Failed to delete CLAUDE.md');
    });

    it('should return empty string when nothing to report', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toBe('');
    });
  });

  describe('formatDetectionSummary', () => {
    it('should include welcoming upgrade header and explanation', () => {
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('正在升级到新版 CodeSpec');
      expect(summary).toContain('标准：skills');
      expect(summary).toContain('保持原有工作流继续可用');
    });

    it('should format config files as files to update (never remove)', () => {
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      // Config files should be in "Files to update", not "Files to remove"
      expect(summary).toContain('待更新文件');
      expect(summary).toContain('• CLAUDE.md');
      // Should NOT be in removals
      expect(summary).not.toContain('No user content to preserve');
    });

    it('should format files to be updated', () => {
      const detection = {
        configFiles: ['CLINE.md'],
        configFilesToUpdate: ['CLINE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('待更新文件');
      expect(summary).toContain('将移除 CodeSpec 标记');
      expect(summary).toContain('保留你的内容');
      expect(summary).toContain('• CLINE.md');
    });

    it('should format slash command directories', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: ['.claude/commands/codespec'],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('待移除文件');
      expect(summary).toContain('• .claude/commands/codespec/');
    });

    it('should format slash command files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.cursor/commands/codespec-proposal.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('待移除文件');
      expect(summary).toContain('• .cursor/commands/codespec-proposal.md');
    });

    it('should format codespec/AGENTS.md', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: true,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('待移除文件');
      expect(summary).toContain('• codespec/AGENTS.md');
    });

    it('should include attention section for project.md', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: true,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: false,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('需要你处理');
      expect(summary).toContain('• codespec/project.md');
      expect(summary).toContain('我们不会删除此文件');
      expect(summary).toContain('config.yaml');
      expect(summary).toContain('"context:"');
    });

    it('should include attention section with other legacy artifacts', () => {
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: true,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      // Config files now in "Files to update", not "Files to remove"
      expect(summary).toContain('待更新文件');
      expect(summary).toContain('CLAUDE.md');
      expect(summary).toContain('需要你处理');
      expect(summary).toContain('codespec/project.md');
    });

    it('should group both removals and updates correctly', () => {
      const detection = {
        configFiles: ['CLAUDE.md', 'CLINE.md'],
        configFilesToUpdate: ['CLAUDE.md', 'CLINE.md'],
        slashCommandDirs: ['.claude/commands/codespec'],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: true,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      // Check both sections exist
      expect(summary).toContain('待移除文件');
      expect(summary).toContain('待更新文件');
      // Check removals (only slash commands and codespec/AGENTS.md)
      expect(summary).toContain('• .claude/commands/codespec/');
      expect(summary).toContain('• codespec/AGENTS.md');
      // Check updates (all config files)
      expect(summary).toContain('• CLAUDE.md');
      expect(summary).toContain('• CLINE.md');
    });

    it('should format deferred global prompts cleanup separately from repo-local files', () => {
      const globalPrompt = path.join(getCodexPromptDir(), 'opsx-explore.md');
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [globalPrompt],
        globalSlashCommandDetails: [{
          path: globalPrompt,
          toolId: 'codex',
          managedFileName: 'opsx-explore.md',
          workflowIds: ['explore'],
          replacementLabel: 'Codex skills',
        }],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDeferredGlobalPromptSummary(detection);
      expect(summary).toContain('延后清理的全局提示');
      expect(summary).toContain('只有安装了对应替代 skill 后，才会移除这些全局提示');
      expect(summary).toContain(`codex: ${globalPrompt}`);
      expect(summary).toContain(globalPrompt);
    });

    it('should return empty string when nothing is detected', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: false,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toBe('');
    });
  });

  describe('formatProjectMdMigrationHint', () => {
    it('should return migration hint message', () => {
      const hint = formatProjectMdMigrationHint();
      expect(hint).toContain('需要你处理');
      expect(hint).toContain('codespec/project.md');
      expect(hint).toContain('我们不会删除此文件');
      expect(hint).toContain('config.yaml');
      expect(hint).toContain('"context:"');
    });

    it('should include actionable instructions', () => {
      const hint = formatProjectMdMigrationHint();
      expect(hint).toContain('将有用内容移入');
      expect(hint).toContain('准备好后再删除此文件');
    });

    it('should explain the new context section benefits', () => {
      const hint = formatProjectMdMigrationHint();
      expect(hint).toContain('包含在每次 CodeSpec 请求中');
      expect(hint).toContain('更可靠');
    });
  });

  describe('LEGACY_CONFIG_FILES', () => {
    it('should include expected config file names', () => {
      expect(LEGACY_CONFIG_FILES).toContain('CLAUDE.md');
      expect(LEGACY_CONFIG_FILES).toContain('CLINE.md');
      expect(LEGACY_CONFIG_FILES).toContain('CODEBUDDY.md');
      expect(LEGACY_CONFIG_FILES).toContain('COSTRICT.md');
      expect(LEGACY_CONFIG_FILES).toContain('QODER.md');
      expect(LEGACY_CONFIG_FILES).toContain('IFLOW.md');
      expect(LEGACY_CONFIG_FILES).toContain('AGENTS.md');
      expect(LEGACY_CONFIG_FILES).toContain('QWEN.md');
    });
  });

  describe('LEGACY_SLASH_COMMAND_PATHS', () => {
    it('should include expected tool patterns', () => {
      expect(LEGACY_SLASH_COMMAND_PATHS['claude']).toEqual({
        type: 'directory',
        path: '.claude/commands/codespec',
      });

      expect(LEGACY_SLASH_COMMAND_PATHS['cursor']).toEqual({
        type: 'files',
        pattern: '.cursor/commands/codespec-*.md',
      });

      expect(LEGACY_SLASH_COMMAND_PATHS['devin']).toEqual({
        type: 'files',
        pattern: '.windsurf/workflows/codespec-*.md',
      });
    });

    it('should only include legacy tool IDs with a command surface capability', () => {
      const registeredTools = new Set(CommandAdapterRegistry.getAll().map(adapter => adapter.toolId));

      for (const tool of Object.keys(LEGACY_SLASH_COMMAND_PATHS)) {
        expect(registeredTools.has(tool) || resolveCommandSurfaceCapability(tool) === 'skills-invocable').toBe(true);
      }

      // Pi was never a pre-1.0 legacy tool
      expect(LEGACY_SLASH_COMMAND_PATHS).not.toHaveProperty('pi');
      // Junie support landed after the opsx rename; it never had codespec-* files
      expect(LEGACY_SLASH_COMMAND_PATHS).not.toHaveProperty('junie');
    });

    it('should use the repo-local compatibility glob pattern for Codex prompt detection', () => {
      const codexPatterns = LEGACY_SLASH_COMMAND_PATHS['codex'];
      expect(codexPatterns.type).toBe('files');
      const patterns = Array.isArray(codexPatterns.pattern) ? codexPatterns.pattern : [codexPatterns.pattern];
      expect(patterns).toContain('.codex/prompts/codespec-*.md');
      expect(patterns).not.toContain('.codex/prompts/opsx-*.md');
    });
  });

  describe('LEGACY_GLOBAL_SLASH_COMMAND_PATHS', () => {
    it('should define the allowlisted managed global Codex prompt names separately from project-local paths', () => {
      const codexPatterns = LEGACY_GLOBAL_SLASH_COMMAND_PATHS['codex'];
      expect(codexPatterns.managedFileNames).toContain('opsx-explore.md');
      expect(codexPatterns.managedFileNames).toContain('opsx-apply.md');
      expect(codexPatterns.managedFileNames).toContain('opsx-update.md');
      expect(codexPatterns.workflowIdsByFileName?.['opsx-update.md']).toEqual(['update']);
      expect(codexPatterns.managedFileNames).not.toContain('opsx-review.md');
      expect(codexPatterns.managedFileNames).not.toContain('codespec-proposal.md');
      expect(codexPatterns.resolvePromptDir()).toBe(getCodexPromptDir());
    });
  });

  describe('getToolsFromLegacyArtifacts', () => {
    it('should extract claude from directory-based legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: ['.claude/commands/codespec'],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('claude');
      expect(tools).toHaveLength(1);
    });

    it('should extract cursor from file-based legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.cursor/commands/codespec-proposal.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(1);
    });

    it('should extract cursor from Windows-style legacy artifact paths', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.cursor\\commands\\codespec-proposal.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(1);
    });

    it('should extract multiple tools from mixed legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: ['.claude/commands/codespec', '.qoder/commands/codespec'],
        slashCommandFiles: ['.cursor/commands/codespec-apply.md', '.windsurf/workflows/codespec-archive.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('claude');
      expect(tools).toContain('qoder');
      expect(tools).toContain('cursor');
      expect(tools).toContain('devin');
      expect(tools).toHaveLength(4);
    });

    it('should deduplicate tools when multiple files match same tool', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [
          '.cursor/commands/codespec-proposal.md',
          '.cursor/commands/codespec-apply.md',
          '.cursor/commands/codespec-archive.md',
        ],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(1);
    });

    it('should extract codex from managed global legacy prompt files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [path.join(getCodexPromptDir(), 'opsx-explore.md')],
        globalSlashCommandDetails: [{
          path: path.join(getCodexPromptDir(), 'opsx-explore.md'),
          toolId: 'codex',
          managedFileName: 'opsx-explore.md',
          workflowIds: ['explore'],
          replacementLabel: 'Codex skills',
        }],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('codex');
      expect(tools).toHaveLength(1);
    });

    it('should return empty array when no legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: false,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toHaveLength(0);
    });

    it('should handle qwen TOML-based legacy files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.qwen/commands/codespec-proposal.toml'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('qwen');
      expect(tools).toHaveLength(1);
    });

    it('should handle continue prompt files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.continue/prompts/codespec-apply.prompt'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('continue');
      expect(tools).toHaveLength(1);
    });

    it('should handle github-copilot prompt files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.github/prompts/codespec-apply.prompt.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('github-copilot');
      expect(tools).toHaveLength(1);
    });

    it('should handle opencode opsx-* legacy files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.opencode/command/opsx-propose.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('opencode');
      expect(tools).toHaveLength(1);
    });

    it('should handle opencode codespec-* legacy files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.opencode/command/codespec-new.md'],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('opencode');
      expect(tools).toHaveLength(1);
    });

    it('should deduplicate opencode when both opsx-* and codespec-* files exist', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [
          '.opencode/command/opsx-propose.md',
          '.opencode/command/codespec-new.md',
        ],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('opencode');
      expect(tools).toHaveLength(1);
    });

    it('should not extract tools from config files only', () => {
      // Config files don't indicate which tools were configured
      // Only slash command dirs/files tell us which tools to upgrade
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        globalSlashCommandFiles: [],
        hasCodeSpecAgents: true,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toHaveLength(0);
    });
  });

  describe('omitToolLegacyArtifacts', () => {
    const baseDetection = () => ({
      configFiles: [],
      configFilesToUpdate: [],
      slashCommandDirs: ['.claude/commands/codespec'],
      slashCommandFiles: ['.codex/prompts/codespec-explore.md', '.cursor/commands/codespec-apply.md'],
      globalSlashCommandFiles: [],
      hasCodeSpecAgents: false,
      hasProjectMd: false,
      hasRootAgentsWithMarkers: false,
      hasLegacyArtifacts: true,
    });

    it('removes only the named tool\'s repo-local artifacts', () => {
      const result = omitToolLegacyArtifacts(baseDetection(), ['codex']);
      expect(result.slashCommandFiles).toEqual(['.cursor/commands/codespec-apply.md']);
      // Other tools' files and directories are untouched.
      expect(result.slashCommandDirs).toEqual(['.claude/commands/codespec']);
      expect(result.hasLegacyArtifacts).toBe(true);
    });

    it('recomputes hasLegacyArtifacts to false when nothing is left', () => {
      const detection = {
        ...baseDetection(),
        slashCommandDirs: [],
        slashCommandFiles: ['.codex/prompts/codespec-explore.md'],
      };
      const result = omitToolLegacyArtifacts(detection, ['codex']);
      expect(result.slashCommandFiles).toEqual([]);
      expect(result.hasLegacyArtifacts).toBe(false);
    });

    it('returns the detection unchanged when no tools are skipped', () => {
      const detection = baseDetection();
      expect(omitToolLegacyArtifacts(detection, [])).toBe(detection);
    });

    it('omits backslash-delimited paths for the skipped tool (Windows)', () => {
      // Defensive: `legacyToolIdForFile` normalizes separators, so a
      // Windows-style path must map to `codex` and be filtered too.
      const detection = {
        ...baseDetection(),
        slashCommandDirs: [],
        slashCommandFiles: ['.codex\\prompts\\codespec-explore.md'],
      };
      const result = omitToolLegacyArtifacts(detection, ['codex']);
      expect(result.slashCommandFiles).toEqual([]);
      expect(result.hasLegacyArtifacts).toBe(false);
    });
  });
});
