## MODIFIED Requirements

### Requirement: Slash Command Updates

The update command SHALL refresh existing slash command files for configured adapter-backed tools without creating new ones, keep legacy command cleanup safe, and treat Codex custom prompts as legacy artifacts that are cleaned up rather than refreshed.

#### Scenario: Updating slash commands for Antigravity
- **WHEN** `.agent/workflows/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh the CodeSpec-managed portion of each file so the workflow copy matches other tools while preserving the existing single-field `description` frontmatter
- **AND** skip creating any missing workflow files during update, mirroring the behavior for Windsurf and other IDEs

#### Scenario: Updating slash commands for Claude Code
- **WHEN** `.claude/commands/codespec/` contains `proposal.md`, `apply.md`, and `archive.md`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for CodeBuddy Code
- **WHEN** `.codebuddy/commands/codespec/` contains `proposal.md`, `apply.md`, and `archive.md`
- **THEN** refresh each file using the shared CodeBuddy templates that include YAML frontmatter for the `description` and `argument-hint` fields
- **AND** use square bracket format for `argument-hint` parameters (e.g., `[change-id]`)
- **AND** preserve any user customizations outside the CodeSpec managed markers

#### Scenario: Updating slash commands for Cline
- **WHEN** `.clinerules/workflows/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using shared templates
- **AND** include Cline-specific Markdown heading frontmatter
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Continue
- **WHEN** `.continue/prompts/` contains `codespec-proposal.prompt`, `codespec-apply.prompt`, and `codespec-archive.prompt`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Crush
- **WHEN** `.crush/commands/` contains `codespec/proposal.md`, `codespec/apply.md`, and `codespec/archive.md`
- **THEN** refresh each file using shared templates
- **AND** include Crush-specific frontmatter with CodeSpec category and tags
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Cursor
- **WHEN** `.cursor/commands/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Factory Droid
- **WHEN** `.factory/commands/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using the shared Factory templates that include YAML frontmatter for the `description` and `argument-hint` fields
- **AND** ensure the template body retains the `$ARGUMENTS` placeholder so user input keeps flowing into droid
- **AND** update only the content inside the CodeSpec managed markers, leaving any unmanaged notes untouched
- **AND** skip creating missing files during update

#### Scenario: Updating slash commands for OpenCode
- **WHEN** `.opencode/command/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage
- **AND** ensure the archive command includes `$ARGUMENTS` placeholder in frontmatter for accepting change ID arguments

#### Scenario: Updating slash commands for Windsurf
- **WHEN** `.windsurf/workflows/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using shared templates wrapped in CodeSpec markers
- **AND** ensure templates include instructions for the relevant workflow stage
- **AND** skip creating missing files (the update command only refreshes what already exists)

#### Scenario: Updating slash commands for Kilo Code
- **WHEN** `.kilocode/workflows/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using shared templates wrapped in CodeSpec markers
- **AND** ensure templates include instructions for the relevant workflow stage
- **AND** skip creating missing files (the update command only refreshes what already exists)

#### Scenario: Codex prompt files are not refreshed
- **GIVEN** the global Codex prompt directory contains CodeSpec-managed Codex prompt files
- **WHEN** a user runs `codespec update`
- **THEN** the command SHALL NOT refresh Codex prompt files
- **AND** it SHALL treat those files as legacy cleanup candidates
- **AND** it SHALL preserve unmanaged files by deleting only exact allowlisted CodeSpec-owned filenames under the resolved global Codex prompt directory after replacement skills exist

#### Scenario: Updating slash commands for GitHub Copilot
- **WHEN** `.github/prompts/` contains `codespec-proposal.prompt.md`, `codespec-apply.prompt.md`, and `codespec-archive.prompt.md`
- **THEN** refresh each file using shared templates while preserving the YAML frontmatter
- **AND** update only the CodeSpec-managed block between markers
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Gemini CLI
- **WHEN** `.gemini/commands/codespec/` contains `proposal.toml`, `apply.toml`, and `archive.toml`
- **THEN** refresh the body of each file using the shared proposal/apply/archive templates
- **AND** replace only the content between `<!-- CODESPEC:START -->` and `<!-- CODESPEC:END -->` markers inside the `prompt = """` block so the TOML framing (`description`, `prompt`) stays intact
- **AND** skip creating any missing `.toml` files during update; only pre-existing Gemini commands are refreshed

#### Scenario: Updating slash commands for iFlow CLI
- **WHEN** `.iflow/commands/` contains `codespec-proposal.md`, `codespec-apply.md`, and `codespec-archive.md`
- **THEN** refresh each file using shared templates
- **AND** preserve the YAML frontmatter with `name`, `id`, `category`, and `description` fields
- **AND** update only the CodeSpec-managed block between markers
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Missing slash command file
- **WHEN** a tool lacks a slash command file
- **THEN** do not create a new file during update

## ADDED Requirements

### Requirement: Codex update uses the skills-invocable command surface
`codespec update` SHALL treat Codex as a skills-invocable tool, not as an adapter-backed command-file tool.

#### Scenario: Codex command surface resolution
- **WHEN** `codespec update` detects Codex as a configured tool
- **THEN** the command SHALL resolve Codex command surface capability as `skills-invocable`
- **AND** it SHALL apply delivery behavior through the shared command-surface capability model when that model is available
- **AND** it SHALL NOT use a Codex-specific delivery predicate that duplicates command-surface capability rules

### Requirement: Codex update uses skills only
`codespec update` SHALL refresh Codex through generated CodeSpec skills without generating or refreshing Codex custom prompt files.

#### Scenario: Legacy Codex prompt migration infers workflows from the legacy filenames
- **WHEN** `codespec update` upgrades an unconfigured Codex tool from detected exact allowlisted global legacy Codex prompt files
- **THEN** it SHALL infer the replacement workflow IDs from the detected prompt filenames where possible
- **AND** it SHALL use that inferred workflow subset for the replacement Codex skills instead of expanding to the current profile's full workflow set

#### Scenario: Updating Codex with default delivery
- **WHEN** a project has Codex CodeSpec skills configured
- **AND** the active delivery mode is `both`
- **THEN** `codespec update` SHALL refresh the selected Codex skill files under `.codex/skills/`
- **AND** it SHALL NOT create or refresh Codex prompt files under `$CODEX_HOME/prompts` or the default Codex prompt directory

#### Scenario: Updating Codex with commands delivery
- **WHEN** a project has Codex configured
- **AND** the active delivery mode is `commands`
- **THEN** `codespec update` SHALL keep Codex usable by refreshing selected Codex skills
- **AND** it SHALL skip Codex command-file generation because Codex is skills-invocable
- **AND** it SHALL NOT remove Codex skills solely because the global delivery mode is `commands`

#### Scenario: Updating Codex with skills delivery
- **WHEN** a project has Codex configured
- **AND** the active delivery mode is `skills`
- **THEN** `codespec update` SHALL refresh selected Codex skills
- **AND** it SHALL treat CodeSpec-managed Codex prompt files as legacy cleanup candidates
- **AND** it SHALL NOT delete global Codex prompt files through ordinary delivery reconciliation without accepted or forced cleanup

### Requirement: Codex update cleanup removes managed legacy prompts
`codespec update` SHALL clean up previously managed Codex prompt files from the resolved global Codex prompt directory only after replacement Codex skills exist.

#### Scenario: Forced update cleanup removes Codex prompts
- **WHEN** a user runs `codespec update --force`
- **AND** the resolved Codex prompt directory contains exact allowlisted managed global Codex prompt files
- **AND** replacement Codex skills exist for the workflows represented by those prompt filenames
- **THEN** the command SHALL remove those managed Codex prompt files
- **AND** it SHALL leave non-CodeSpec Codex prompt files unchanged

#### Scenario: Configured Codex cleanup completes after skills refresh
- **WHEN** an approved or forced update detects an allowlisted global Codex prompt whose configured project is missing the replacement skill
- **AND** the configured-tool update installs that replacement skill, including under `delivery=commands`
- **THEN** the command SHALL perform deferred global prompt cleanup after the configured-tool update loop
- **AND** it SHALL remove the replaced prompt in the same update run

#### Scenario: Interactive update cleanup includes Codex prompts
- **WHEN** a user runs `codespec update` interactively
- **THEN** the preview SHALL list immediate repo-local removals separately from deferred global prompts cleanup
- **AND** the deferred section SHALL list the concrete global prompt paths before the user confirms cleanup
- **AND** managed Codex prompt files are detected
- **THEN** the cleanup prompt SHALL include those files in the cleanup plan
- **AND** accepting cleanup SHALL remove only the prompt files whose replacement Codex skills exist

#### Scenario: Non-interactive update without force does not delete prompts
- **WHEN** a user runs `codespec update` without interaction and without `--force`
- **AND** managed Codex prompt files are detected
- **THEN** the command SHALL warn that legacy cleanup requires `--force` or an interactive run
- **AND** it SHALL NOT delete Codex prompt files
