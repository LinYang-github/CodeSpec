## MODIFIED Requirements

### Requirement: Skill Generation

The command SHALL generate Agent Skills for selected AI tools.

#### Scenario: Generating skills for a tool

- **WHEN** a tool is selected during initialization
- **THEN** create 9 skill directories under `.<tool>/skills/`:
  - `codespec-explore/SKILL.md`
  - `codespec-new-change/SKILL.md`
  - `codespec-continue-change/SKILL.md`
  - `codespec-apply-change/SKILL.md`
  - `codespec-ff-change/SKILL.md`
  - `codespec-verify-change/SKILL.md`
  - `codespec-sync-specs/SKILL.md`
  - `codespec-archive-change/SKILL.md`
  - `codespec-bulk-archive-change/SKILL.md`
- **AND** each SKILL.md SHALL contain YAML frontmatter with name and description
- **AND** each SKILL.md SHALL contain the skill instructions

#### Scenario: Pre-approving the CodeSpec CLI in skill frontmatter

- **WHEN** generating a skill's YAML frontmatter
- **THEN** the frontmatter SHALL include an `allowed-tools` field with the value `Bash(codespec:*)`
- **AND** an agent that honors `allowed-tools` SHALL run `codespec` commands from the skill without prompting for approval
- **AND** because `allowed-tools` pre-approves rather than restricts, any other tool the skill uses SHALL remain available under the user's existing permission settings
