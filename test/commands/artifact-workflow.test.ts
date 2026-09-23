import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runCLI } from '../helpers/run-cli.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { approveStage } from '../../src/core/codespec-workflow/approvals.js';
import { loadChangeArtifacts } from '../../src/core/codespec-workflow/artifacts.js';
import { loadWorkspace } from '../../src/core/codespec-workflow/loaders.js';
import { createCurrentArchiveFixture, requirement, modification } from '../helpers/current-archive.js';
import { createCanonicalChange as newCanonicalChange } from '../../src/core/codespec-workflow/change-manager.js';
import { approveChangeStage, isApprovalCurrent } from '../../src/core/codespec-workflow/approvals.js';
import { transitionChange } from '../../src/core/codespec-workflow/state-machine.js';
import { parseAnalysisDocument } from '../../src/core/codespec-workflow/analysis.js';
import { parseCurrentSpecDelta, renderCurrentSpecDelta } from '../../src/core/codespec-workflow/current-spec-delta.js';
import { parseCurrentSpecification, type CurrentSpecRequirement } from '../../src/core/codespec-workflow/current-spec-model.js';
import { recordFreshVerification, verificationArtifactIdentity } from '../../src/core/codespec-workflow/verification.js';
import { archiveChange } from '../../src/core/codespec-workflow/archive-transaction.js';
import { ShowCommand } from '../../src/commands/show.js';
import { snapshotDirectory } from '../helpers/fs-snapshot.js';
import { canonicalGuidance } from '../../src/commands/workflow/canonical-guidance.js';

const execFileAsync = promisify(execFile);

describe('canonical clarification closed loop in one process', () => {
  it('archives two independently approved Changes to the same Requirement without carrying history or replacing its module', async () => {
    const fixture = await createCurrentArchiveFixture();
    const originalCwd = process.cwd();
    const artifactNames = ['analysis.yaml', 'design.md', 'metadata.yaml', 'spec.md', 'tasks.yaml', 'verification.yaml'];
    const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
    const currentBefore = await fs.readFile(currentPath, 'utf8');
    const unrelatedBytes = (text: string) => text.slice(text.indexOf('\n## MOD-002-REQ-002：'), text.indexOf('\n### 当前模块工程文件'));
    const unrelatedBefore = unrelatedBytes(currentBefore);
    const untouchedModule = snapshotDirectory(path.join(fixture.paths.currentSpecs, 'MOD-001'));
    let previous: CurrentSpecRequirement = fixture.current.requirements[0];
    try {
      process.chdir(fixture.tempDir);
      await fs.writeFile(fixture.paths.configuration, stringifyYaml({ version: 1, profiles: [{ id: 'test', services: [] }] }));
      for (const round of [1, 2]) {
        const baselineBytes = await fs.readFile(currentPath, 'utf8');
        const workspace = await loadWorkspace(fixture.codespecDir);
        const created = await newCanonicalChange(workspace, { title: `Independent change ${round}`, summary: `Request ${round}`, mode: 'feature' });
        const load = () => loadChangeArtifacts(workspace.paths, created.changeId);
        const write = (name: string, content: string) => fs.writeFile(path.join(created.changeDir, name), content);
        const transition = async (target: Parameters<typeof transitionChange>[2]) => {
          await transitionChange(workspace, await load(), target, `Complete preceding stage for ${target}`);
          const artifacts = await load();
          expect(artifacts.metadata.change.status).toBe(target);
          expect(parseYaml(await fs.readFile(fixture.paths.changeIndex, 'utf8')).changes).toEqual([expect.objectContaining({ id: created.changeId, status: target })]);
        };
        expect((await fs.readdir(created.changeDir)).sort()).toEqual(artifactNames);
        expect((await load()).metadata.change.status).toBe('ANALYZE');
        await expect(approveChangeStage(workspace, await load(), 'analyze')).rejects.toThrow();
        const analysis = parseAnalysisDocument({
          version: 1, change: created.changeId, revision: 1, problem: `Request ${round}`,
          goals: [{ id: 'GOAL-001', statement: 'Support the requested additional state' }], nonGoals: [],
          scope: { in: ['Additional state for the selected Requirement'], out: ['Other Requirements'] },
          actors: ['User'], constraints: [], assumptions: [], openQuestions: [],
          acceptanceCriteria: [{ id: 'AC-001', statement: 'Existing and additional states pass verification', priority: 'MUST', requirements: ['MOD-002-REQ-001'] }],
          modules: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'Owns the requested behavior' }],
          requirements: [{ id: 'MOD-002-REQ-001', action: 'MODIFIED', reason: `Reason exclusive to round ${round}` }],
        });
        await write('analysis.yaml', stringifyYaml(analysis));
        const guidance = await canonicalGuidance(workspace, await load());
        expect(guidance.analysisSummary?.complete).toBe(true);
        expect(guidance.nextAction.action).toBe('request_approval');
        await expect(transitionChange(workspace, await load(), 'DESIGN', 'Missing approval')).rejects.toThrow(/确认|approval/i);
        await approveChangeStage(workspace, await load(), 'analyze');
        await transition('DESIGN');

        const output: string[] = [];
        const capture = vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)); });
        try { await new ShowCommand().execute('MOD-002', { type: 'spec', requirement: 'MOD-002-REQ-001', json: true, noInteractive: true }); }
        finally { capture.mockRestore(); }
        expect(output).toHaveLength(1);
        const selected: CurrentSpecRequirement = JSON.parse(output[0]);
        expect(selected).toEqual(previous);
        expect(output[0]).not.toContain('MOD-002-REQ-002');
        const next = requirement('MOD-002-REQ-001', round === 1 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'E']);
        const delta = modification(selected, next);
        delta.title = `Delta exclusive to round ${round}`;
        delta.requirements[0].reason = `Reason exclusive to round ${round}`;
        const spec = renderCurrentSpecDelta(delta);
        await write('spec.md', spec);
        await write('design.md', `# Design\n\nMOD-002-REQ-001\n\n## SDD 分级依据\n\nSingle module additive behavior.\n\n## 归档影响分析\n\n\`\`\`yaml\noutcome: none\nreferences: []\nverification: []\n\`\`\`\n`);
        expect(parseCurrentSpecDelta(spec).requirements).toHaveLength(1);
        expect(parseCurrentSpecDelta(spec).requirements[0].previous).toEqual(previous);
        expect(spec).not.toContain('MOD-002-REQ-002');
        if (round === 2) for (const forbidden of ['Delta exclusive to round 1', 'Reason exclusive to round 1']) expect(spec).not.toContain(forbidden);
        await expect(transitionChange(workspace, await load(), 'PLAN', 'Missing design approval')).rejects.toThrow(/确认|approval/i);
        await approveChangeStage(workspace, await load(), 'design');
        await transition('PLAN');
        await expect(approveChangeStage(workspace, await load(), 'plan')).rejects.toThrow(/任务图|Task/);
        const command = `node -e "const fs = require('node:fs'); require('node:assert/strict').ok(fs.readFileSync('src/one.ts', 'utf8').includes('value = ${round}'))"`;
        const tasks = {
          version: 1, changeRevision: 1, moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] },
          tasks: next.scenarios.map((scenario, index) => ({
            id: `${created.changeId}-TASK-0${index + 1}`, title: `Implement ${scenario.title}`, status: 'PENDING',
            acceptanceCriteria: ['AC-001'], requirements: [next.id], scenarios: [scenario.id], testCases: scenario.testCases.map((test) => test.id), plannedFiles: ['src/one.ts'],
            verificationPlan: scenario.testCases.map((test) => ({ testCase: test.id, runner: 'node', command, profile: 'test', services: [], prepare: 'none', cleanup: 'none' })),
          })),
        };
        await write('tasks.yaml', stringifyYaml(tasks));
        await expect(transitionChange(workspace, await load(), 'IMPLEMENT', 'Missing plan approval')).rejects.toThrow(/确认|approval/i);
        await approveChangeStage(workspace, await load(), 'plan');
        await transition('IMPLEMENT');
        await expect(transitionChange(workspace, await load(), 'VERIFY', 'Tasks still pending')).rejects.toThrow(/DONE/);
        await fs.writeFile(path.join(fixture.tempDir, 'src', 'one.ts'), `export const value = ${round};\n`);
        tasks.tasks.forEach((task) => { task.status = 'DONE'; });
        await write('tasks.yaml', stringifyYaml(tasks));
        expect(isApprovalCurrent('plan', await load())).toBe(true);
        await transition('VERIFY');
        await expect(transitionChange(workspace, await load(), 'ARCHIVE', 'Evidence missing')).rejects.toThrow();
        const evidence = await recordFreshVerification(workspace, created.changeId, tasks.tasks.flatMap((task) => task.verificationPlan.map((plan) => ({ ...plan, kind: 'requirements' as const, testFile: 'src/one.ts', testId: plan.testCase }))));
        expect(evidence.trace_rows).toEqual(tasks.tasks.map((task) => expect.objectContaining({ acceptance_id: 'AC-001', requirement_id: 'MOD-002-REQ-001', scenario_id: task.scenarios[0], task_id: task.id, test_id: task.testCases[0], result: 'PASS' })));
        const verified = await load();
        expect(parseYaml(verified.verification)).toMatchObject({ changeRevision: 1, artifactIdentity: verificationArtifactIdentity(verified), testCases: tasks.tasks.map((task) => expect.objectContaining({ testCase: task.testCases[0], acceptanceCriteria: ['AC-001'], result: 'PASS', exitCode: 0 })) });
        await transition('ARCHIVE');
        expect(await fs.readFile(currentPath, 'utf8')).toBe(baselineBytes);
        const archived = await archiveChange(workspace, created.changeId);
        expect(archived.requirementIds).toEqual(['MOD-002-REQ-001']);
        expect(archived.archivedPath).toBe(path.join(fixture.paths.currentSpecs, 'MOD-002'));
        await expect(fs.access(created.changeDir)).rejects.toThrow();
        expect(parseYaml(await fs.readFile(fixture.paths.changeIndex, 'utf8')).changes).toEqual([]);
        const currentBytes = await fs.readFile(currentPath, 'utf8');
        const current = parseCurrentSpecification(currentBytes);
        for (const task of tasks.tasks) expect(currentBytes).toContain(`\`${task.testCases[0]}\`：PASS`);
        expect(current.requirements.map((entry) => entry.id)).toEqual(['MOD-002-REQ-001', 'MOD-002-REQ-002']);
        expect(current.requirements[0].scenarios.map((scenario) => scenario.title)).toEqual(round === 1 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'E']);
        expect(current.requirements[1]).toEqual(fixture.current.requirements[1]);
        expect(unrelatedBefore.length).toBeGreaterThan(0);
        expect(unrelatedBytes(currentBytes)).toBe(unrelatedBefore);
        expect(current.engineeringFiles[1]).toEqual(fixture.current.engineeringFiles[1]);
        expect(snapshotDirectory(path.join(fixture.paths.currentSpecs, 'MOD-001'))).toEqual(untouchedModule);
        previous = current.requirements[0];
      }
      await expect(fs.access(path.join(fixture.codespecDir, 'archive'))).rejects.toThrow();
    } finally { process.chdir(originalCwd); fixture.cleanup(); }
  }, 30_000);
});

describe('artifact-workflow CLI commands', () => {
  let tempDir: string;
  let changesDir: string;

  const canonical = (targetPath: string): string => FileSystemUtils.canonicalizeExistingPath(targetPath);

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-artifact-workflow-'));
    changesDir = path.join(tempDir, 'codespec', 'changes');
    await fs.mkdir(changesDir, { recursive: true });
    // These fixtures exercise the explicit legacy schema surface. Canonical
    // code-spec behavior is covered by the dedicated helpers below.
    await fs.writeFile(path.join(tempDir, 'codespec', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Gets combined output from CLI result (ora outputs to stdout).
   */
  function getOutput(result: { stdout: string; stderr: string }): string {
    return result.stdout + result.stderr;
  }

  /**
   * Normalizes path separators to forward slashes for cross-platform assertions.
   */
  function normalizePaths(str: string): string {
    return str.replace(/\\/g, '/');
  }

  it('rejects unknown approval stages before loading a Change', async () => {
    const result = await runCLI(['approve', '--change', 'CHG-20260901-001', '--stage', 'review'], { cwd: tempDir });

    expect(result.exitCode).toBe(1);
    expect(getOutput(result)).toMatch(/analyze.*design.*plan/i);
  });

  it('revises an approved changed authority and prints the revision result as JSON', async () => {
    await createCanonicalCodeSpecWorkspace();
    const changeId = await createCanonicalChange('VERIFY');
    const workspace = await loadWorkspace(path.join(tempDir, 'codespec'));
    const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
    const metadata = approveStage(artifacts, 'design');
    const metadataPath = path.join(changesDir, changeId, 'metadata.yaml');
    await fs.writeFile(metadataPath, stringifyYaml(metadata));
    await fs.appendFile(path.join(changesDir, changeId, 'design.md'), '\nChanged scope\n');
    const result = await runCLI(['revise', '--change', changeId, '--reason', 'scope changed'], { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ changeId, previousRevision: 2, revision: 3, route: 'DESIGN', invalidatedApprovals: ['design', 'plan'] });
    const noop = await runCLI(['revise', '--change', changeId, '--reason', 'nothing changed'], { cwd: tempDir });
    expect(noop.exitCode).toBe(1);
    expect(getOutput(noop)).toMatch(/no semantic|语义/i);
  });

  it.each([
    [['--reason', 'scope changed'], /change/i],
    [['--change', 'CHG-20260901-001', '--reason', '   '], /reason|原因/i],
  ])('rejects invalid revise arguments %j', async (args, error) => {
    await createCanonicalCodeSpecWorkspace();
    await createCanonicalChange('VERIFY');
    const result = await runCLI(['revise', ...args], { cwd: tempDir });
    expect(result.exitCode).toBe(1);
    expect(getOutput(result)).toMatch(error);
  });

  /**
   * Creates a test change with the specified artifacts completed.
   * Note: An "active" change requires at least a proposal.md file to be detected.
   * If no artifacts are specified, we create an empty proposal to make it detectable.
   */
  async function createTestChange(
    changeName: string,
    artifacts: ('proposal' | 'design' | 'specs' | 'tasks')[] = []
  ): Promise<string> {
    const changeDir = path.join(changesDir, changeName);
    await fs.mkdir(changeDir, { recursive: true });

    // Always create proposal.md for the change to be detected as active
    // Content varies based on whether 'proposal' is in artifacts list
    const proposalContent = artifacts.includes('proposal')
      ? '## Why\nTest proposal content that is long enough.\n\n## What Changes\n- **test:** Something'
      : '## Why\nMinimal proposal.\n\n## What Changes\n- **test:** Placeholder';
    await fs.writeFile(path.join(changeDir, 'proposal.md'), proposalContent);

    if (artifacts.includes('design')) {
      await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n\nTechnical design.');
    }

    if (artifacts.includes('specs')) {
      // specs artifact uses glob pattern "specs/*.md" - files directly in specs/ directory
      const specsDir = path.join(changeDir, 'specs');
      await fs.mkdir(specsDir, { recursive: true });
      await fs.writeFile(path.join(specsDir, 'test-spec.md'), '## Purpose\nTest spec.');
    }

    if (artifacts.includes('tasks')) {
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '## Tasks\n- [ ] Task 1');
    }

    return changeDir;
  }

  async function createCanonicalCodeSpecWorkspace(): Promise<void> {
    await fs.mkdir(path.join(tempDir, 'codespec', 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'codespec', 'config.yaml'),
      [
        'version: 1',
        'schema: "code-spec"',
        'project:',
        '  name: demo',
        'paths:',
        '  business: business.yaml',
        '  configuration: configuration.yaml',
        '  changes: changes',
        '  change_index: changes/index.yaml',
        '  specs: specs',
        '  transactions: .transactions',
        'workflow:',
        '  multiple_active_changes: true',
        'requirements:',
        "  id_format: '{module}-REQ-{sequence:03d}'",
        'changes:',
        "  id_format: 'CHG-{date}-{sequence:03d}'",
        'archive:',
        '  update_index: true',
        '  require_verification: true',
        "  conflict_strategy: optimistic",
        '',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(tempDir, 'codespec', 'business.yaml'),
      [
        'version: 1',
        'modules:',
        '  - id: MOD-001',
        '    name: Order Management',
        '    status: ACTIVE',
        '    inputs: []',
        '    outputs: []',
        '    relatedModules: []',
        '  - id: MOD-002',
        '    name: User Management',
        '    status: ACTIVE',
        '    inputs: []',
        '    outputs: []',
        '    relatedModules: []',
      ].join('\n')
    );
    await fs.writeFile(path.join(tempDir, 'codespec', 'configuration.yaml'), 'version: 1\nprofiles: []\n');
    await fs.writeFile(path.join(changesDir, 'index.yaml'), 'version: 1\nchanges: []\n');
    await execFileAsync('git', ['init', '--quiet'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.email', 'codespec-tests@example.com'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.name', 'CodeSpec Tests'], { cwd: tempDir });
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'Initialize fixture'], { cwd: tempDir });
  }

  async function createCanonicalChange(
    status: string,
    metadataOverrides: Record<string, any> = {}
  ): Promise<string> {
    const changeId = 'CHG-20260901-001';
    const changeDir = path.join(changesDir, changeId);
    const timestamp = '2026-09-01T00:00:00.000Z';

    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'metadata.yaml'),
      stringifyYaml({
        schema_version: 1,
        change: {
          id: changeId,
          revision: 2,
          title: 'Continue orders',
          mode: 'feature',
          sdd_level: 2,
          status,
          created_at: timestamp,
          updated_at: timestamp,
        },
        impact: {
          summary: 'Continue order submission',
          mode: 'feature',
          scope: 'single-module',
          affected_areas: [],
        },
        baseline: {
          created_at: timestamp,
          commit: null,
          working_tree_fingerprint: `sha256:${'0'.repeat(64)}`,
          current_fingerprint: '0'.repeat(64),
          stale: false,
          modules: {},
        },
        gates: {
          analyze: { required: true, satisfied: true },
          design: { required: true, satisfied: status !== 'ANALYZE' },
          plan: { required: true, satisfied: status === 'IMPLEMENT' || status === 'VERIFY' || status === 'ARCHIVE' },
          implement: { required: true, satisfied: status === 'VERIFY' || status === 'ARCHIVE' },
          verify: { required: true, satisfied: status === 'ARCHIVE' },
          archive: { required: true, satisfied: false },
        },
        approvals: {
          schema_version: 1,
          analyze: { status: 'pending', revision: 2, content_hash: '', approved_at: null },
          design: { status: 'pending', revision: 2, content_hash: '', approved_at: null },
          plan: { status: 'pending', revision: 2, content_hash: '', approved_at: null },
        },
        modules: {
          candidates: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'Owns users' }],
          confirmed: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'Owns users' }],
          dependencies: [],
        },
        requirements: {
          added: [],
          modified: [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }],
          removed: [],
        },
        artifacts: {
          analysis: `changes/${changeId}/analysis.yaml`,
          metadata: `changes/${changeId}/metadata.yaml`,
          design: `changes/${changeId}/design.md`,
          spec: `changes/${changeId}/spec.md`,
          tasks: `changes/${changeId}/tasks.yaml`,
          verification: `changes/${changeId}/verification.yaml`,
        },
        tasks: {
          total: 1,
          completed: status === 'VERIFY' || status === 'ARCHIVE' ? 1 : 0,
          items: {
            'SP-01': {
              title: 'Implement order continuation',
              status: status === 'VERIFY' || status === 'ARCHIVE' ? 'DONE' : 'TODO',
            },
          },
        },
        verification: {
          requirements_verified: status === 'ARCHIVE',
          tests_passed: status === 'ARCHIVE',
          build_passed: status === 'ARCHIVE',
          lint_passed: status === 'ARCHIVE',
          verified_at: status === 'ARCHIVE' ? timestamp : null,
        },
        archive: {
          ready: status === 'ARCHIVE',
          conflict: false,
        },
        ...metadataOverrides,
      })
    );
    await fs.writeFile(
      path.join(changeDir, 'analysis.yaml'),
      stringifyYaml({
        version: 1, change: changeId, revision: 2, problem: 'Continue order submission',
        goals: [{ id: 'GOAL-001', statement: 'Continue checkout' }], nonGoals: [], scope: { in: ['Checkout'], out: ['Other flows'] },
        actors: ['User'], constraints: [], assumptions: [], openQuestions: [],
        acceptanceCriteria: [{ id: 'AC-001', statement: 'Checkout continues', priority: 'MUST', requirements: ['MOD-002-REQ-001'] }],
        modules: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'Owns users' }],
        requirements: [{ id: 'MOD-002-REQ-001', action: 'MODIFIED', reason: 'Continue checkout' }],
      })
    );
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n\n## SDD 分级依据\n\nSingle module.\n\n## 归档影响分析\n\n```yaml\noutcome: none\nreferences: []\nverification: []\n```\n');
    await fs.writeFile(path.join(changeDir, 'spec.md'), renderCurrentSpecDelta(modification()));
    await fs.writeFile(path.join(changeDir, 'tasks.yaml'), 'version: 1\nchangeRevision: 2\ntasks: []\nmoduleDeltas: []\nmoduleRegistrations: { upsert: [], retire: [] }\n');
    await fs.writeFile(path.join(changeDir, 'verification.yaml'), 'version: 1\nchangeRevision: 2\ntestCases: []\n');

    await fs.writeFile(
      path.join(changesDir, 'index.yaml'),
      stringifyYaml({
        version: 1,
        changes: [
          {
            id: changeId,
            title: 'Continue orders',
            mode: 'feature',
            status,
            updated_at: timestamp,
          },
        ],
      })
    );

    return changeId;
  }

  async function createBrokenCanonicalWorkspace(): Promise<void> {
    await fs.mkdir(path.join(tempDir, 'codespec', 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'codespec', 'config.yaml'),
      [
        'version: 1',
        'schema: code-spec',
        'project:',
        '  name: demo',
        'paths:',
        '  business: business.yaml',
        '  configuration: configuration.yaml',
        '  changes: changes',
        '  change_index: changes/index.yaml',
        '  specs: specs',
        '  transactions: .transactions',
        'workflow:',
        '  multiple_active_changes: true',
        'requirements:',
        "  id_format: '{module}-REQ-{sequence:03d}'",
        'changes:',
        "  id_format: 'CHG-{date}-{sequence:03d}'",
        'archive:',
        '  update_index: true',
        '  require_verification: true',
        "  conflict_strategy: optimistic",
        '',
      ].join('\n')
    );
    await fs.writeFile(path.join(changesDir, 'index.yaml'), 'version: 1\nchanges: []\n');
  }

  describe('status command', () => {
    it('rejects a canonical CHG directory without metadata instead of using legacy status', async () => {
      await createCanonicalCodeSpecWorkspace();
      const changeDir = path.join(changesDir, 'CHG-20260901-099');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');

      const result = await runCLI(['status', '--change', 'CHG-20260901-099'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      expect(getOutput(result)).toContain('未找到 canonical Change 元数据');
      expect(getOutput(result)).not.toMatch(/schema:|artifacts complete/i);
    });

    it('fails explicitly instead of resolving legacy slug Changes when canonical loading is broken', async () => {
      await createBrokenCanonicalWorkspace();
      await createTestChange('legacy-slug');

      const result = await runCLI(['status', '--change', 'legacy-slug'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      expect(getOutput(result)).toContain('business.yaml');
    });

    it('includes canonical lifecycle fields and gate diagnostics in JSON status output', async () => {
      await createCanonicalCodeSpecWorkspace();
      await createCanonicalChange('ANALYZE', {
        gates: {
          analyze: { required: true, satisfied: false },
          design: { required: true, satisfied: false },
          plan: { required: true, satisfied: false },
          implement: { required: true, satisfied: false },
          verify: { required: true, satisfied: false },
          archive: { required: true, satisfied: false },
        },
      });

      const result = await runCLI(['status', '--change', 'CHG-20260901-001', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.changeId).toBe('CHG-20260901-001');
      expect(json.status).toBe('ANALYZE');
      expect(json.revision).toBe(2);
      expect(json.baseline).toBeDefined();
      expect(json.requirements).toBeDefined();
      expect(json.verification).toBeDefined();
      expect(json.gateErrors).toEqual(expect.arrayContaining([expect.stringMatching(/Requirement|MOD-002-REQ-001/i)]));
    });

    it('shows status for scaffolded change without proposal.md', async () => {
      // Create empty change directory (no proposal.md)
      const changeDir = path.join(changesDir, 'scaffolded-change');
      await fs.mkdir(changeDir, { recursive: true });

      const result = await runCLI(['status', '--change', 'scaffolded-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('scaffolded-change');
      expect(result.stdout).toContain('进度：0/4 个产物已完成');
    });

    it('shows status for a change with proposal only', async () => {
      // createTestChange always creates proposal.md, so this has 1 artifact complete
      await createTestChange('minimal-change');

      const result = await runCLI(['status', '--change', 'minimal-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('minimal-change');
      expect(result.stdout).toContain('spec-driven');
      expect(result.stdout).toContain('进度：1/4 个产物已完成');
    });

    it('shows status for a change with proposal and design', async () => {
      await createTestChange('partial-change', ['proposal', 'design']);

      const result = await runCLI(['status', '--change', 'partial-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('进度：2/4 个产物已完成');
      expect(result.stdout).toContain('[x]');
    });

    it('outputs JSON when --json flag is used', async () => {
      await createTestChange('json-change', ['proposal', 'design']);

      const result = await runCLI(['status', '--change', 'json-change', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      expect(json.changeName).toBe('json-change');
      expect(json.schemaName).toBe('spec-driven');
      expect(json.isPlanningComplete).toBe(false);
      expect(json.isComplete).toBe(false);
      expect(Array.isArray(json.artifacts)).toBe(true);
      expect(json.artifacts).toHaveLength(4);

      const proposalArtifact = json.artifacts.find((a: any) => a.id === 'proposal');
      expect(proposalArtifact.status).toBe('done');
    });

    it('recommends specs before design for a proposal-only change', async () => {
      await createTestChange('order-change');

      const result = await runCLI(['status', '--change', 'order-change', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.artifacts.map((a: any) => a.id)).toEqual(['proposal', 'specs', 'design', 'tasks']);
      expect(json.nextSteps[0]).toContain('codespec instructions specs');
    });

    it('shows planning completion when all artifacts exist', async () => {
      await createTestChange('complete-change', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['status', '--change', 'complete-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('进度：4/4 个产物已完成');
      expect(result.stdout).toContain('全部规划产物已完成！');
      expect(result.stdout).not.toContain('全部产物已完成！');
    });

    it('distinguishes planning completion from implementation task completion', async () => {
      await createTestChange('planned-change', ['proposal', 'design', 'specs', 'tasks']);

      const statusResult = await runCLI(['status', '--change', 'planned-change', '--json'], {
        cwd: tempDir,
      });
      const applyResult = await runCLI(
        ['instructions', 'apply', '--change', 'planned-change', '--json'],
        { cwd: tempDir }
      );

      expect(statusResult.exitCode).toBe(0);
      expect(applyResult.exitCode).toBe(0);

      const status = JSON.parse(statusResult.stdout);
      const apply = JSON.parse(applyResult.stdout);
      expect(status.isPlanningComplete).toBe(true);
      expect(status.isComplete).toBe(true);
      expect(status.nextSteps[0]).toContain(
        'codespec instructions apply --change "planned-change" --json'
      );
      expect(status.nextSteps[0]).not.toContain('before implementation');
      expect(apply.state).toBe('ready');
      expect(apply.progress.remaining).toBe(1);
    });

    it('reports skipped planning artifacts as complete without creating them', async () => {
      const changeDir = await createTestChange('skip-specs-change', [
        'proposal',
        'design',
        'tasks',
      ]);
      await fs.writeFile(
        path.join(changeDir, '.codespec.yaml'),
        'schema: spec-driven\nskip_specs: true\n'
      );

      const result = await runCLI(['status', '--change', 'skip-specs-change', '--json'], {
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      const status = JSON.parse(result.stdout);
      expect(status.isPlanningComplete).toBe(true);
      expect(status.isComplete).toBe(status.isPlanningComplete);
      expect(status.artifacts.find((artifact: any) => artifact.id === 'specs')?.status).toBe(
        'skipped'
      );
      await expect(fs.stat(path.join(changeDir, 'specs'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('exits gracefully when no changes exist', async () => {
      const result = await runCLI(['status'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('没有活动 Change');
      expect(result.stdout).toContain('codespec new change');
    });

    it('exits gracefully with JSON when no changes exist', async () => {
      const result = await runCLI(['status', '--json'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.changes).toEqual([]);
      expect(json.message).toBe('没有活动 Change。');
    });

    it('errors when --change is missing and lists available changes', async () => {
      await createTestChange('some-change');

      const result = await runCLI(['status'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('缺少必需选项 --change');
      expect(output).toContain('some-change');
    });

    it('errors for unknown change name and lists available changes', async () => {
      await createTestChange('existing-change');

      const result = await runCLI(['status', '--change', 'nonexistent'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("未找到 Change 'nonexistent'");
      expect(output).toContain('existing-change');
    });

    it('supports --schema option', async () => {
      await createTestChange('schema-change');

      const result = await runCLI(['status', '--change', 'schema-change', '--schema', 'spec-driven'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('spec-driven');
    });

    it('errors for unknown schema', async () => {
      await createTestChange('test-change');

      const result = await runCLI(['status', '--change', 'test-change', '--schema', 'unknown'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("未找到 Schema 'unknown'");
    });

    it('rejects path traversal in change name', async () => {
      const result = await runCLI(['status', '--change', '../foo'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Change 名称');
    });

    it('rejects absolute path in change name', async () => {
      const result = await runCLI(['status', '--change', '/etc/passwd'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Change 名称');
    });

    it('rejects slashes in change name', async () => {
      const result = await runCLI(['status', '--change', 'foo/bar'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Change 名称');
    });

    it('rejects hidden directory names', async () => {
      const result = await runCLI(['status', '--change', '.hidden'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Change 名称');
    });

    it('rejects the reserved archive directory name', async () => {
      await fs.mkdir(path.join(changesDir, 'archive'), { recursive: true });

      const result = await runCLI(['status', '--change', 'archive'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Change 名称');
    });

    it('accepts digit-leading change names that exist on disk (#1308)', async () => {
      await createTestChange('2026-07-04-voice-copilot-v1', ['proposal', 'design']);

      const result = await runCLI(['status', '--change', '2026-07-04-voice-copilot-v1'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('2026-07-04-voice-copilot-v1');
      expect(result.stdout).toContain('进度：2/4 个产物已完成');
    });
  });

  describe('instructions command', () => {
    it('renders canonical analyze instructions instead of generic artifact scaffolding', async () => {
      await createCanonicalCodeSpecWorkspace();
      await createCanonicalChange('ANALYZE');

      const result = await runCLI(['instructions', 'analyze', '--change', 'CHG-20260901-001'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('## Analyze：CHG-20260901-001');
      expect(result.stdout).toContain('当前状态：ANALYZE');
      expect(result.stdout).toContain('design.md');
      expect(result.stdout).toContain('tasks.yaml');
      expect(result.stdout).not.toContain('proposal.md');
      expect(result.stdout).not.toContain('<artifact id="analyze"');
    });

    it('shows instructions for proposal on scaffolded change', async () => {
      // Create empty change directory (no proposal.md)
      const changeDir = path.join(changesDir, 'scaffolded-change');
      await fs.mkdir(changeDir, { recursive: true });

      const result = await runCLI(['instructions', 'proposal', '--change', 'scaffolded-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<artifact id="proposal"');
      expect(result.stdout).toContain('proposal.md');
      expect(result.stdout).toContain('<template>');
    });

    it('shows instructions for design artifact', async () => {
      await createTestChange('instr-change');

      const result = await runCLI(['instructions', 'design', '--change', 'instr-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<artifact id="design"');
      expect(result.stdout).toContain('design.md');
      expect(result.stdout).toContain('<template>');
    });

    it('shows blocked warning for artifact with unmet dependencies', async () => {
      // tasks depends on design and specs, which are not done yet
      await createTestChange('blocked-change');

      const result = await runCLI(['instructions', 'tasks', '--change', 'blocked-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<warning>');
      expect(result.stdout).toContain('status="missing"');
    });

    it('outputs JSON for instructions', async () => {
      await createTestChange('json-instr', ['proposal']);

      const result = await runCLI(['instructions', 'design', '--change', 'json-instr', '--json'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      expect(json.artifactId).toBe('design');
      expect(json.outputPath).toContain('design.md');
      expect(typeof json.template).toBe('string');
      expect(Array.isArray(json.dependencies)).toBe(true);
    });

    it('errors when artifact argument is missing', async () => {
      await createTestChange('test-change');

      const result = await runCLI(['instructions', '--change', 'test-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('缺少必需参数 <artifact>');
      expect(output).toContain('有效产物');
    });

    it('errors for unknown artifact', async () => {
      await createTestChange('test-change');

      const result = await runCLI(['instructions', 'unknown-artifact', '--change', 'test-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("未找到产物 'unknown-artifact'");
      expect(output).toContain('有效产物');
    });

    it('accepts digit-leading change names that exist on disk (#1308)', async () => {
      await createTestChange('2026-07-04-voice-copilot-v1', ['proposal']);

      const result = await runCLI(
        ['instructions', 'design', '--change', '2026-07-04-voice-copilot-v1'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<artifact id="design"');
    });
  });

  describe('templates command', () => {
    it('shows template paths for default schema', async () => {
      const result = await runCLI(['templates'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Schema：code-spec');
      expect(result.stdout).toContain('metadata:');
      expect(result.stdout).toContain('design:');
      expect(result.stdout).toContain('spec:');
      expect(result.stdout).toContain('tasks:');
      expect(result.stdout).toContain('tasks.yaml');
      expect(result.stdout).toContain('verification.yaml');
    });

    it('shows template paths for specified schema', async () => {
      const result = await runCLI(['templates', '--schema', 'spec-driven'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Schema：spec-driven');
      expect(result.stdout).toContain('proposal:');
      expect(result.stdout).toContain('design:');
    });

    it('outputs JSON mapping of templates', async () => {
      const result = await runCLI(['templates', '--json'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      expect(json.metadata).toBeDefined();
      expect(json.metadata.path).toContain('metadata.yaml');
      expect(json.metadata.source).toBe('package');
      expect(json.tasks.path).toContain('tasks.yaml');
      expect(json.verification.path).toContain('verification.yaml');
    });

    it('errors for unknown schema', async () => {
      const result = await runCLI(['templates', '--schema', 'nonexistent'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("未找到 Schema 'nonexistent'");
    });
  });

  describe('new change command', () => {
    it('creates a canonical Change directory for code-spec workspaces', async () => {
      await createCanonicalCodeSpecWorkspace();

      const result = await runCLI(['new', 'change', 'my-new-feature'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      const output = getOutput(result);
      expect(output).toContain('已创建 Change：CHG-');
      expect(output).toContain('codespec status --change CHG-');

      const createdId = output.match(/已创建 Change：((CHG-\d{8}-\d{3}))/)?.[1];
      expect(createdId).toMatch(/^CHG-\d{8}-\d{3}$/);

      const changeDir = path.join(changesDir, createdId!);
      const stat = await fs.stat(changeDir);
      expect(stat.isDirectory()).toBe(true);

      const metadata = parseYaml(await fs.readFile(path.join(changeDir, 'metadata.yaml'), 'utf-8')) as {
        change: { id: string; title: string; status: string };
      };
      expect(metadata.change.id).toBe(createdId);
      expect(metadata.change.title).toBe('my-new-feature');
      expect(metadata.change.status).toBe('ANALYZE');

      const index = parseYaml(await fs.readFile(path.join(changesDir, 'index.yaml'), 'utf-8')) as {
        changes: Array<{ id: string; title: string }>;
      };
      expect(index.changes[0]).toMatchObject({ id: createdId, title: 'my-new-feature' });
      await expect(fs.stat(path.join(changeDir, '.codespec.yaml'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('keeps canonical Changes to the six-file contract when a description is supplied', async () => {
      await createCanonicalCodeSpecWorkspace();

      const result = await runCLI(
        ['new', 'change', 'described-canonical-feature', '--description', 'Canonical context'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      const output = getOutput(result);
      const createdId = output.match(/已创建 Change：((CHG-\d{8}-\d{3}))/)?.[1];
      expect(createdId).toMatch(/^CHG-\d{8}-\d{3}$/);
      expect((await fs.readdir(path.join(changesDir, createdId!))).sort()).toEqual([
        'analysis.yaml', 'design.md', 'metadata.yaml', 'spec.md', 'tasks.yaml', 'verification.yaml',
      ]);
      await expect(fs.stat(path.join(changesDir, createdId!, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('supports deprecated change new as an alias for canonical Change creation', async () => {
      await createCanonicalCodeSpecWorkspace();

      const result = await runCLI(['change', 'new', 'billing-resume'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      const output = getOutput(result);
      expect(output).toContain('已弃用');
      expect(output).toContain('已创建 Change：CHG-');
    });

    it('rejects a user-supplied canonical Change id as the new change name', async () => {
      await createCanonicalCodeSpecWorkspace();

      const result = await runCLI(['new', 'change', 'CHG-20260901-001'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('canonical Change ID 会自动分配');
    });

    it('fails explicitly instead of falling back when canonical workspace loading is broken', async () => {
      await createBrokenCanonicalWorkspace();

      const result = await runCLI(['new', 'change', 'fallback-slug'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      expect(getOutput(result)).toContain('business.yaml');
      await expect(fs.stat(path.join(changesDir, 'fallback-slug'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('marks changes as skip_specs when their schema cannot generate specs', async () => {
      const schemaDir = path.join(tempDir, 'codespec', 'schemas', 'no-specs');
      await fs.mkdir(path.join(schemaDir, 'templates'), { recursive: true });
      await fs.writeFile(
        path.join(schemaDir, 'schema.yaml'),
        `name: no-specs
version: 1
artifacts:
  - id: proposal
    generates: proposal.md
    description: Proposal
    template: proposal.md
    requires: []
  - id: tasks
    generates: tasks.md
    description: Tasks
    template: tasks.md
    requires: [proposal]
apply:
  requires: [tasks]
  tracks: tasks.md
`
      );
      await fs.writeFile(path.join(schemaDir, 'templates', 'proposal.md'), '# Proposal\n');
      await fs.writeFile(path.join(schemaDir, 'templates', 'tasks.md'), '# Tasks\n');
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        'schema: no-specs\n'
      );

      const result = await runCLI(['new', 'change', 'no-spec-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(0);

      const metadata = await fs.readFile(
        path.join(changesDir, 'no-spec-change', '.codespec.yaml'),
        'utf-8'
      );
      expect(metadata).toContain('skip_specs: true');

      const validation = await runCLI(
        ['validate', 'no-spec-change', '--type', 'change'],
        { cwd: tempDir }
      );
      expect(validation.exitCode).toBe(0);
    });

    it('does not mark spec-producing schemas that use Windows separators', async () => {
      const schemaName = 'windows-specs';
      const generates = String.raw`specs\**\*.md`;
      const schemaDir = path.join(tempDir, 'codespec', 'schemas', schemaName);
      await fs.mkdir(path.join(schemaDir, 'templates'), { recursive: true });
      await fs.writeFile(
        path.join(schemaDir, 'schema.yaml'),
        `name: ${schemaName}
version: 1
artifacts:
  - id: specs
    generates: '${generates}'
    description: Specs
    template: spec.md
    requires: []
`
      );
      await fs.writeFile(path.join(schemaDir, 'templates', 'spec.md'), '# Spec\n');
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: ${schemaName}\n`
      );

      const changeName = `${schemaName}-change`;
      const result = await runCLI(['new', 'change', changeName], { cwd: tempDir });
      expect(result.exitCode).toBe(0);

      const changeDir = path.join(changesDir, changeName);
      const metadata = await fs.readFile(path.join(changeDir, '.codespec.yaml'), 'utf-8');
      expect(metadata).not.toContain('skip_specs');

      const specDir = path.join(changeDir, 'specs', 'example');
      await fs.mkdir(specDir, { recursive: true });
      await fs.writeFile(
        path.join(specDir, 'spec.md'),
        `## ADDED Requirements
### Requirement: Example behavior
The system SHALL support the example behavior.

#### Scenario: Example succeeds
- **WHEN** the example runs
- **THEN** it succeeds
`
      );

      const status = await runCLI(['status', '--change', changeName, '--json'], {
        cwd: tempDir,
      });
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout).artifacts[0].status).toBe('done');

      const validation = await runCLI(['validate', changeName, '--type', 'change'], {
        cwd: tempDir,
      });
      expect(validation.exitCode).toBe(0);
    });

    it('rejects --initiative and writes no change', async () => {
      const result = await runCLI(
        ['new', 'change', 'linked-change', '--initiative', 'billing-launch'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('--initiative 已不再支持');
      await expect(fs.stat(path.join(changesDir, 'linked-change'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('rejects --areas and writes no affected-area metadata', async () => {
      const result = await runCLI(['new', 'change', 'area-change', '--areas', 'api'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('--areas 已不再支持');
      await expect(fs.stat(path.join(changesDir, 'area-change'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('keeps --goal as ordinary metadata without switching schema', async () => {
      const result = await runCLI(
        ['new', 'change', 'goal-change', '--goal', 'Improve billing'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const metadata = await fs.readFile(
        path.join(changesDir, 'goal-change', '.codespec.yaml'),
        'utf-8'
      );
      expect(metadata).toContain('schema: spec-driven');
      expect(metadata).toContain('goal: Improve billing');
      expect(metadata).not.toContain('affected_areas');
      expect(metadata).not.toContain('initiative');
    });

    it('creates README.md when --description is provided', async () => {
      const result = await runCLI(
        ['new', 'change', 'described-feature', '--description', 'This is a test feature'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const readmePath = path.join(changesDir, 'described-feature', 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      expect(content).toContain('described-feature');
      expect(content).toContain('This is a test feature');
    });

    it('errors for invalid change name with spaces', async () => {
      const result = await runCLI(['new', 'change', 'invalid name'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('错误：');
    });

    it('errors for duplicate change name', async () => {
      await createTestChange('existing-change');

      const result = await runCLI(['new', 'change', 'existing-change'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('exists');
    });

    it('errors when name argument is missing', async () => {
      const result = await runCLI(['new', 'change'], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
    });
  });

  describe('instructions apply command', () => {
    it('shows apply instructions for spec-driven schema with tasks', async () => {
      await createTestChange('apply-change', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['instructions', 'apply', '--change', 'apply-change'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('## 实现：apply-change');
      expect(result.stdout).toContain('Schema：spec-driven');
      expect(result.stdout).toContain('### 上下文文件');
      expect(result.stdout).toContain('### 指导');
    });

    it('shows blocked state when required artifacts are missing', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
context: Required blocked-state context
operations:
  apply:
    guidance:
      - Advisory blocked-state guidance
`
      );
      // Only create proposal - missing tasks (required by spec-driven apply block)
      await createTestChange('blocked-apply', ['proposal']);

      const result = await runCLI(['instructions', 'apply', '--change', 'blocked-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('已阻塞');
      expect(result.stdout).toContain('缺少产物：tasks');
      expect(result.stdout).toContain('### 项目上下文（必需的指导输入）');
      expect(result.stdout).toContain('### 操作指导（建议）');
    });

    it('outputs JSON for apply instructions', async () => {
      await createTestChange('json-apply', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'json-apply', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout);
      const expectedProposalPath = canonical(path.join(changesDir, 'json-apply', 'proposal.md'));
      const expectedSpecPath = canonical(path.join(changesDir, 'json-apply', 'specs', 'test-spec.md'));
      expect(json.changeName).toBe('json-apply');
      expect(json.schemaName).toBe('spec-driven');
      expect(json.state).toBe('ready');
      expect(json.contextFiles).toBeDefined();
      expect(typeof json.contextFiles).toBe('object');
      expect(json.contextFiles.proposal).toEqual([expectedProposalPath]);
      expect(json.contextFiles.specs).toEqual([expectedSpecPath]);
    });

    it('returns current context and matching apply guidance as separate JSON fields', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
context: |
  Current project context
rules:
  specs:
    - Artifact-only rule
operations:
  apply:
    guidance:
      - Apply guidance
  archive:
    guidance:
      - Archive guidance
`
      );
      await createTestChange('apply-inputs', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-inputs', '--json'],
        { cwd: tempDir }
      );

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.context).toBe('Current project context\n');
      expect(json.operationGuidance).toEqual(['Apply guidance']);
      expect(JSON.stringify(json)).not.toContain('Archive guidance');
      expect(JSON.stringify(json)).not.toContain('Artifact-only rule');
      expect(json.state).toBe('ready');
      expect(json.progress).toEqual({ total: 1, complete: 0, remaining: 1 });
      expect(json.tasks).toEqual([{ id: '1', description: 'Task 1', done: false }]);
      expect(json.contextFiles).toBeDefined();
      expect(json.root).toBeDefined();
    });

    it('renders required context and advisory apply guidance as distinct text sections', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
context: Project background
operations:
  apply:
    guidance:
      - Keep summaries concise
`
      );
      await createTestChange('apply-text-inputs', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-text-inputs'],
        { cwd: tempDir }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('### 指导');
      expect(result.stdout).toContain('### 项目上下文（必需的指导输入）');
      expect(result.stdout).toContain('Project background');
      expect(result.stdout).toContain('### 操作指导（建议）');
      expect(result.stdout).toContain('- Keep summaries concise');
      expect(result.stdout).not.toContain('### Project Context (advisory)');
    });

    it('omits absent operation inputs without changing apply state behavior', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
rules:
  specs:
    - Artifact-only rule
`
      );
      await createTestChange('apply-no-inputs', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-no-inputs', '--json'],
        { cwd: tempDir }
      );

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.context).toBeUndefined();
      expect(json.operationGuidance).toBeUndefined();
      expect(json.state).toBe('ready');
      expect(JSON.stringify(json)).not.toContain('Artifact-only rule');
    });

    it('reads a fresh apply config snapshot on every command invocation', async () => {
      const configPath = path.join(tempDir, 'codespec', 'config.yaml');
      await createTestChange('apply-fresh-inputs', ['proposal', 'design', 'specs', 'tasks']);
      await fs.writeFile(
        configPath,
        `schema: spec-driven
context: Initial context
operations:
  apply:
    guidance:
      - Initial guidance
`
      );

      const first = await runCLI(
        ['instructions', 'apply', '--change', 'apply-fresh-inputs', '--json'],
        { cwd: tempDir }
      );
      await fs.writeFile(
        configPath,
        `schema: spec-driven
context: Updated context
operations:
  apply:
    guidance:
      - Updated guidance
`
      );
      const second = await runCLI(
        ['instructions', 'apply', '--change', 'apply-fresh-inputs', '--json'],
        { cwd: tempDir }
      );

      expect(JSON.parse(first.stdout)).toMatchObject({
        context: 'Initial context',
        operationGuidance: ['Initial guidance'],
      });
      expect(JSON.parse(second.stdout)).toMatchObject({
        context: 'Updated context',
        operationGuidance: ['Updated guidance'],
      });
    });

    it('reads malformed operation config once and emits one warning per command', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
operations:
  apply:
    guidance: invalid
`
      );
      await createTestChange('apply-one-warning', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-one-warning', '--json'],
        { cwd: tempDir }
      );

      expect(result.exitCode).toBe(0);
      const matches = result.stderr.match(
        /操作 'apply' 的指导必须是字符串数组/g
      );
      expect(matches).toHaveLength(1);
      expect(JSON.parse(result.stdout).operationGuidance).toBeUndefined();
    });

    it('resolves single-star glob artifacts consistently between status and apply', async () => {
      const schemaDir = path.join(tempDir, 'codespec', 'schemas', 'glob-test');
      const templatesDir = path.join(schemaDir, 'templates');
      await fs.mkdir(templatesDir, { recursive: true });

      await fs.writeFile(
        path.join(schemaDir, 'schema.yaml'),
        `name: glob-test
version: 1
description: Test schema for single-star globs
artifacts:
  - id: specs
    generates: specs/*/spec.md
    description: Nested specs
    template: spec.md
    requires: []
apply:
  requires: [specs]
  instruction: Ready when specs exist.
`
      );
      await fs.writeFile(path.join(templatesDir, 'spec.md'), '# Spec\n');

      const changeDir = path.join(changesDir, 'single-star-glob');
      const specPath = path.join(changeDir, 'specs', 'single-star-glob', 'spec.md');
      await fs.mkdir(path.dirname(specPath), { recursive: true });
      await fs.writeFile(path.join(changeDir, '.codespec.yaml'), 'schema: glob-test\n');
      await fs.writeFile(specPath, '# Nested spec\n');

      const statusResult = await runCLI(['status', '--change', 'single-star-glob', '--json'], {
        cwd: tempDir,
      });
      expect(statusResult.exitCode).toBe(0);
      const statusJson = JSON.parse(statusResult.stdout);
      expect(statusJson.artifacts).toEqual([
        {
          id: 'specs',
          outputPath: 'specs/*/spec.md',
          status: 'done',
          requires: [],
        },
      ]);

      const applyResult = await runCLI(
        ['instructions', 'apply', '--change', 'single-star-glob', '--json'],
        { cwd: tempDir }
      );
      expect(applyResult.exitCode).toBe(0);
      const applyJson = JSON.parse(applyResult.stdout);
      const resolvedSpecPath = canonical(specPath);
      expect(applyJson.state).toBe('ready');
      expect(applyJson.missingArtifacts).toBeUndefined();
      expect(applyJson.contextFiles).toEqual({
        specs: [resolvedSpecPath],
      });
    });

    it('shows schema instruction from apply block', async () => {
      await createTestChange('instr-apply', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(['instructions', 'apply', '--change', 'instr-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      // Should show the instruction from spec-driven schema apply block
      expect(result.stdout).toContain('work through pending tasks');
    });

    it('shows all_done state when all tasks are complete', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
context: Required all-done context
operations:
  apply:
    guidance:
      - Advisory all-done guidance
`
      );
      const changeDir = await createTestChange('done-apply', [
        'proposal',
        'design',
        'specs',
        'tasks',
      ]);
      // Overwrite tasks with all completed
      await fs.writeFile(
        path.join(changeDir, 'tasks.md'),
        '## Tasks\n- [x] Task 1\n- [x] Task 2'
      );

      const result = await runCLI(['instructions', 'apply', '--change', 'done-apply'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('已完成 ✓');
      expect(result.stdout).toContain('可以归档');
      expect(result.stdout).toContain('### 项目上下文（必需的指导输入）');
      expect(result.stdout).toContain('### 操作指导（建议）');
    });

    it('uses spec-driven schema apply configuration', async () => {
      // Create a spec-driven style change with all artifacts
      await createTestChange('apply-schema-test', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-schema-test', '--schema', 'spec-driven'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Schema：spec-driven');
    });

    it('spec-driven schema uses apply block configuration', async () => {
      // Verify that spec-driven schema uses its apply block (requires: [tasks])
      await createTestChange('apply-config-test', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'apply-config-test', '--json'],
        { cwd: tempDir }
      );
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      // spec-driven schema has apply block with requires: [tasks], so should be ready
      expect(json.schemaName).toBe('spec-driven');
      expect(json.state).toBe('ready');
    });

    it('fallback: requires all artifacts when schema has no apply block', async () => {
      // Create a minimal schema without an apply block in user schemas dir
      const userDataDir = path.join(tempDir, 'user-data');
      const noApplySchemaDir = path.join(userDataDir, 'codespec', 'schemas', 'no-apply');
      const templatesDir = path.join(noApplySchemaDir, 'templates');
      await fs.mkdir(templatesDir, { recursive: true });

      // Minimal schema with 2 artifacts, no apply block
      const schemaContent = `
name: no-apply
version: 1
description: Test schema without apply block
artifacts:
  - id: first
    generates: first.md
    description: First artifact
    template: first.md
    requires: []
  - id: second
    generates: second.md
    description: Second artifact
    template: second.md
    requires: [first]
`;
      await fs.writeFile(path.join(noApplySchemaDir, 'schema.yaml'), schemaContent);
      await fs.writeFile(path.join(templatesDir, 'first.md'), '# First\n');
      await fs.writeFile(path.join(templatesDir, 'second.md'), '# Second\n');

      // Create a change with only the first artifact (missing second)
      const changeDir = path.join(changesDir, 'no-apply-test');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'first.md'), '# First artifact content');

      // Run with XDG_DATA_HOME pointing to our temp user data dir
      const result = await runCLI(
        ['instructions', 'apply', '--change', 'no-apply-test', '--schema', 'no-apply', '--json'],
        {
          cwd: tempDir,
          env: { XDG_DATA_HOME: userDataDir },
        }
      );
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      // Without apply block, fallback requires ALL artifacts - second is missing
      expect(json.schemaName).toBe('no-apply');
      expect(json.state).toBe('blocked');
      expect(json.missingArtifacts).toContain('second');
    });

    it('fallback: ready when all artifacts exist for schema without apply block', async () => {
      // Create a minimal schema without an apply block
      const userDataDir = path.join(tempDir, 'user-data-2');
      const noApplySchemaDir = path.join(userDataDir, 'codespec', 'schemas', 'no-apply-full');
      const templatesDir = path.join(noApplySchemaDir, 'templates');
      await fs.mkdir(templatesDir, { recursive: true });

      const schemaContent = `
name: no-apply-full
version: 1
description: Test schema without apply block
artifacts:
  - id: only
    generates: only.md
    description: Only artifact
    template: only.md
    requires: []
`;
      await fs.writeFile(path.join(noApplySchemaDir, 'schema.yaml'), schemaContent);
      await fs.writeFile(path.join(templatesDir, 'only.md'), '# Only\n');

      // Create a change with the artifact present
      const changeDir = path.join(changesDir, 'no-apply-full-test');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'only.md'), '# Content');

      const result = await runCLI(
        ['instructions', 'apply', '--change', 'no-apply-full-test', '--schema', 'no-apply-full', '--json'],
        {
          cwd: tempDir,
          env: { XDG_DATA_HOME: userDataDir },
        }
      );
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      // All artifacts exist, should be ready with default instruction
      expect(json.schemaName).toBe('no-apply-full');
      expect(json.state).toBe('ready');
      expect(json.instruction).toContain('全部必需产物已完成');
    });
  });

  describe('instructions archive command', () => {
    it('returns current archive context, guidance, and the root envelope in JSON', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
context: Archive project context
rules:
  specs:
    - Artifact-only rule
operations:
  apply:
    guidance:
      - Apply guidance
  archive:
    guidance:
      - Archive guidance
`
      );
      await createTestChange('archive-inputs', ['proposal', 'design', 'specs', 'tasks']);

      const result = await runCLI(
        ['instructions', 'archive', '--change', 'archive-inputs', '--json'],
        { cwd: tempDir }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        changeName: 'archive-inputs',
        context: 'Archive project context',
        operationGuidance: ['Archive guidance'],
        root: {
          path: canonical(tempDir),
          source: 'nearest',
        },
      });
      expect(result.stdout).not.toContain('Apply guidance');
      expect(result.stdout).not.toContain('Artifact-only rule');
      expect(result.stdout).not.toContain('Perform the archive');
    });

    it('renders required context and advisory archive guidance as separate text sections', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        `schema: spec-driven
context: Archive background
operations:
  archive:
    guidance:
      - Summarize the outcome
`
      );
      await createTestChange('archive-text-inputs');

      const result = await runCLI(
        ['instructions', 'archive', '--change', 'archive-text-inputs'],
        { cwd: tempDir }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('## 归档输入：archive-text-inputs');
      expect(result.stdout).toContain('### 项目上下文（必需的指导输入）');
      expect(result.stdout).toContain('Archive background');
      expect(result.stdout).toContain('### 操作指导（建议）');
      expect(result.stdout).toContain('- Summarize the outcome');
      expect(result.stdout).not.toContain('### Project Context (advisory)');
    });

    it('succeeds with valid empty inputs and omits optional JSON fields', async () => {
      await fs.writeFile(
        path.join(tempDir, 'codespec', 'config.yaml'),
        'schema: spec-driven\n'
      );
      await createTestChange('archive-no-inputs');

      const jsonResult = await runCLI(
        ['instructions', 'archive', '--change', 'archive-no-inputs', '--json'],
        { cwd: tempDir }
      );
      const textResult = await runCLI(
        ['instructions', 'archive', '--change', 'archive-no-inputs'],
        { cwd: tempDir }
      );

      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout);
      expect(json.changeName).toBe('archive-no-inputs');
      expect(json.context).toBeUndefined();
      expect(json.operationGuidance).toBeUndefined();
      expect(textResult.stdout).toContain(
        '未配置项目上下文或操作指导。'
      );
    });

    it('requires a change and rejects changes outside the selected root', async () => {
      await createTestChange('available-change');

      const missing = await runCLI(['instructions', 'archive', '--json'], {
        cwd: tempDir,
      });
      const invalid = await runCLI(
        ['instructions', 'archive', '--change', 'missing-change', '--json'],
        { cwd: tempDir }
      );

      expect(missing.exitCode).toBe(1);
      expect(JSON.parse(missing.stdout).status[0].message).toContain(
        '缺少必需选项 --change'
      );
      expect(invalid.exitCode).toBe(1);
      expect(JSON.parse(invalid.stdout).status[0].message).toContain(
        "未找到 Change 'missing-change'"
      );
    });

    it('reads fresh archive inputs without mutating specs or the change', async () => {
      const configPath = path.join(tempDir, 'codespec', 'config.yaml');
      const changeDir = await createTestChange('archive-read-only', [
        'proposal',
        'design',
        'specs',
        'tasks',
      ]);
      const proposalPath = path.join(changeDir, 'proposal.md');
      const proposalBefore = await fs.readFile(proposalPath, 'utf-8');
      await fs.writeFile(
        configPath,
        `schema: spec-driven
context: First archive context
operations:
  archive:
    guidance:
      - First archive guidance
`
      );

      const first = await runCLI(
        ['instructions', 'archive', '--change', 'archive-read-only', '--json'],
        { cwd: tempDir }
      );
      await fs.writeFile(
        configPath,
        `schema: spec-driven
context: Second archive context
operations:
  archive:
    guidance:
      - Second archive guidance
`
      );
      const second = await runCLI(
        ['instructions', 'archive', '--change', 'archive-read-only', '--json'],
        { cwd: tempDir }
      );

      expect(JSON.parse(first.stdout)).toMatchObject({
        context: 'First archive context',
        operationGuidance: ['First archive guidance'],
      });
      expect(JSON.parse(second.stdout)).toMatchObject({
        context: 'Second archive context',
        operationGuidance: ['Second archive guidance'],
      });
      expect(await fs.readFile(proposalPath, 'utf-8')).toBe(proposalBefore);
      expect(await fs.readdir(path.join(changeDir, 'specs'))).toEqual(['test-spec.md']);
      expect(
        await fs.readdir(path.join(tempDir, 'codespec', 'changes'))
      ).toContain('archive-read-only');
      expect(
        await fs
          .stat(path.join(tempDir, 'codespec', 'specs'))
          .then(() => true)
          .catch(() => false)
      ).toBe(false);
    });
  });

  describe('help text', () => {
    it('status command help shows description', async () => {
      const result = await runCLI(['status', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('显示 Change 的产物完成状态');
    });

    it('instructions command help shows description', async () => {
      const result = await runCLI(['instructions', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('输出产物、apply 或 archive 的增强指导');
    });

    it('templates command help shows description', async () => {
      const result = await runCLI(['templates', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('显示 Schema 中所有产物解析后的模板路径');
    });

    it('new command help shows description', async () => {
      const result = await runCLI(['new', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('创建新条目');
    });
  });

  describe('experimental command (deprecated alias for init)', () => {
    it('shows deprecation notice', async () => {
      const result = await runCLI(['experimental', '--tool', 'claude'], { cwd: tempDir });
      // May succeed or fail depending on setup, but should show deprecation notice
      const output = getOutput(result);
      expect(output).toContain('已弃用');
    });

    it('errors for unknown tool', async () => {
      const result = await runCLI(['experimental', '--tool', 'unknown-tool'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain('Invalid tool(s): unknown-tool');
    });

    it('creates skills for the shared agents target', async () => {
      const result = await runCLI(['experimental', '--tool', 'agents'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);

      const skillFile = path.join(tempDir, '.agents', 'skills', 'codespec-workflow', 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);
    });

    it('creates skills for Claude tool', async () => {
      const result = await runCLI(['experimental', '--tool', 'claude'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      const output = normalizePaths(getOutput(result));
      expect(output).toContain('Claude Code');
      expect(output).toContain('.claude/');

      // Verify skill files were created
      const skillFile = path.join(tempDir, '.claude', 'skills', 'codespec-workflow', 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);
    });

    it('creates skills for Cursor tool', async () => {
      const result = await runCLI(['experimental', '--tool', 'cursor'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      const output = normalizePaths(getOutput(result));
      expect(output).toContain('Cursor');
      expect(output).toContain('.cursor/');

      // Verify skill files were created
      const skillFile = path.join(tempDir, '.cursor', 'skills', 'codespec-workflow', 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);

      // Verify commands were created with Cursor format
      const commandFile = path.join(tempDir, '.cursor', 'commands', 'codespec-workflow.md');
      const content = await fs.readFile(commandFile, 'utf-8');
      expect(content).toContain('name: "/codespec-workflow"');
    });

    it('creates skills for the retired windsurf id, under Devin Desktop', async () => {
      const result = await runCLI(['experimental', '--tool', 'windsurf'], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      const output = normalizePaths(getOutput(result));
      expect(output).toContain('Devin Desktop');
      expect(output).toContain('.devin/');

      // Verify skill files were created
      const skillFile = path.join(tempDir, '.devin', 'skills', 'codespec-workflow', 'SKILL.md');
      const stat = await fs.stat(skillFile);
      expect(stat.isFile()).toBe(true);
    });
  });

  describe('project config integration', () => {
    describe('new change uses config schema', () => {
      it('creates change with schema from project config', async () => {
        // Create project config with spec-driven schema
        // Note: changesDir is already at tempDir/codespec/changes (created in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'codespec', 'config.yaml'),
          'schema: spec-driven\n'
        );

        // Create a new change without specifying schema
        const result = await runCLI(['new', 'change', 'test-change'], { cwd: tempDir, timeoutMs: 30000 });
        expect(result.exitCode).toBe(0);

        // Verify the change was created with spec-driven schema
        const metadataPath = path.join(changesDir, 'test-change', '.codespec.yaml');
        const metadata = await fs.readFile(metadataPath, 'utf-8');
        expect(metadata).toContain('schema: spec-driven');
      }, 60000);

      it('CLI schema overrides config schema', async () => {
        // Create project config with spec-driven schema
        // Note: codespec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'codespec', 'config.yaml'),
          'schema: spec-driven\n'
        );

        // Create change with explicit schema
        const result = await runCLI(
          ['new', 'change', 'override-test', '--schema', 'spec-driven'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);

        // Verify the change uses the CLI-specified schema
        const metadataPath = path.join(changesDir, 'override-test', '.codespec.yaml');
        const metadata = await fs.readFile(metadataPath, 'utf-8');
        expect(metadata).toContain('schema: spec-driven');
      }, 60000);
    });

    describe('instructions command with config', () => {
      it('injects context and rules from config into instructions', async () => {
        // Create project config with context and rules
        // Note: codespec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'codespec', 'config.yaml'),
          `schema: spec-driven
context: |
  Tech stack: TypeScript, React
  API style: RESTful
rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
`
        );

        // Create a test change
        await createTestChange('config-test');

        // Get instructions for proposal
        const result = await runCLI(
          ['instructions', 'proposal', '--change', 'config-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);

        // Verify context is injected
        expect(result.stdout).toContain('Tech stack: TypeScript, React');
        expect(result.stdout).toContain('API style: RESTful');

        // Verify rules are injected for proposal
        expect(result.stdout).toContain('Include rollback plan');
        expect(result.stdout).toContain('Identify affected teams');
      }, 60000);

      it('does not inject rules for non-matching artifact', async () => {
        // Create project config with rules only for proposal
        // Note: codespec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'codespec', 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - Include rollback plan
`
        );

        // Create a test change
        await createTestChange('non-matching-test');

        // Get instructions for design (not proposal)
        const result = await runCLI(
          ['instructions', 'design', '--change', 'non-matching-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);

        // Verify rules are NOT injected for design
        expect(result.stdout).not.toContain('Include rollback plan');
      }, 60000);
    });

    describe('backwards compatibility', () => {
      it('existing changes work without config file', async () => {
        // Create change without any config file
        await fs.rm(path.join(tempDir, 'codespec', 'config.yaml'));
        await createTestChange('no-config-change', ['proposal']);

        // Status command should work
        const statusResult = await runCLI(
          ['status', '--change', 'no-config-change'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(statusResult.exitCode).toBe(0);
        expect(statusResult.stdout).toContain('no-config-change');
        expect(statusResult.stdout).toContain('code-spec'); // Canonical default schema

        // Instructions command should work
        const instrResult = await runCLI(
          ['instructions', 'design', '--change', 'no-config-change'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(instrResult.exitCode).toBe(0);
        expect(instrResult.stdout).toContain('<artifact');
      }, 60000);

      it('changes with metadata work without config file', async () => {
        // Create change with explicit schema in metadata
        await fs.rm(path.join(tempDir, 'codespec', 'config.yaml'));
        const changeDir = await createTestChange('metadata-only-change');
        await fs.writeFile(
          path.join(changeDir, '.codespec.yaml'),
          'schema: spec-driven\ncreated: "2025-01-05"\n'
        );

        // Status should use schema from metadata
        const result = await runCLI(
          ['status', '--change', 'metadata-only-change'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('spec-driven');
      }, 60000);
    });

    describe('config changes reflected immediately', () => {
      it('config changes are reflected without restart', async () => {
        // Create initial config
        // Note: codespec directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(
          path.join(tempDir, 'codespec', 'config.yaml'),
          `schema: spec-driven
context: Initial context
`
        );

        // Create a test change
        await createTestChange('immediate-test');

        // Get instructions - should have initial context
        const result1 = await runCLI(
          ['instructions', 'proposal', '--change', 'immediate-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result1.exitCode).toBe(0);
        expect(result1.stdout).toContain('Initial context');

        // Update config
        await fs.writeFile(
          path.join(tempDir, 'codespec', 'config.yaml'),
          `schema: spec-driven
context: Updated context
`
        );

        // Get instructions again - should have updated context
        const result2 = await runCLI(
          ['instructions', 'proposal', '--change', 'immediate-test'],
          { cwd: tempDir, timeoutMs: 30000 }
        );
        expect(result2.exitCode).toBe(0);
        expect(result2.stdout).toContain('Updated context');
        expect(result2.stdout).not.toContain('Initial context');
      }, 60000);
    });
  });
});
