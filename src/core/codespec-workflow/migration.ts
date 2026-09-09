import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { loadBusinessRegistry } from './business-registry.js';
import { getWorkspacePaths } from './paths.js';
import { parseWorkspaceConfig } from './schemas.js';
import { parseCurrentSpecification } from './current-spec-model.js';

const exists = async (file: string): Promise<boolean> => fs.access(file).then(() => true).catch(() => false);

function renderLegacySpecification(name: string, module: string, original: string): string {
  const preserved = original.replace(/-->/gu, '--&gt;');
  return [
    `# ${name}`,
    '',
    `- **模块编号：** ${module}`,
    '- **规格版本：** legacy',
    '',
    '### 当前模块工程文件',
    '',
    '| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |',
    '| --- | --- | --- |',
    '',
    '<!-- 迁移保留的旧规格；首次触及该模块时必须补全 v1 Requirement、Scenario、测试用例与工程文件追溯。',
    preserved,
    '-->',
    '',
  ].join('\n');
}

async function migrateActiveLegacyChanges(changesDirectory: string): Promise<void> {
  const entries = await fs.readdir(changesDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/u.test(entry.name)) continue;
    const metadataFile = path.join(changesDirectory, entry.name, 'metadata.yaml');
    const raw = await fs.readFile(metadataFile, 'utf8');
    const metadata = parseYaml(raw) as any;
    if (!metadata?.artifacts?.proposal) continue;
    metadata.change.revision += 1;
    metadata.change.status = 'DESIGN';
    metadata.change.updated_at = new Date().toISOString();
    metadata.approvals = {
      schema_version: 1,
      design: { status: 'pending', revision: metadata.change.revision, content_hash: '', approved_at: null },
      plan: { status: 'pending', revision: metadata.change.revision, content_hash: '', approved_at: null },
    };
    metadata.gates.design.satisfied = false;
    metadata.gates.plan.satisfied = false;
    metadata.gates.implement.satisfied = false;
    metadata.gates.verify.satisfied = false;
    metadata.gates.archive.satisfied = false;
    metadata.archive.ready = false;
    await fs.writeFile(metadataFile, stringifyYaml(metadata));
  }
}

/** Converts only unambiguous legacy registry data; first-touch modules remain explicitly legacy. */
export async function migrateLegacyWorkspace(codespecDir: string): Promise<void> {
  const configFile = path.join(codespecDir, 'config.yaml');
  const rawConfig = parseYaml(await fs.readFile(configFile, 'utf8')) as Record<string, any>;
  const config = parseWorkspaceConfig(rawConfig);
  const paths = getWorkspacePaths(codespecDir, config);
  // A workspace may already use the v1 root files while still containing an
  // active legacy Change. Migration must invalidate that Change's approvals;
  // the v1 path is otherwise a no-op for the root documents.
  await migrateActiveLegacyChanges(paths.changes);
  if (rawConfig.paths?.business === 'business.yaml' && rawConfig.paths?.configuration) return;
  const registry = await loadBusinessRegistry(paths);
  const businessFile = path.join(codespecDir, 'business.yaml');

  await fs.writeFile(businessFile, stringifyYaml({
    version: 1,
    modules: registry.modules.map((module) => ({
      id: module.id,
      name: module.name,
      status: 'ACTIVE',
      inputs: [],
      outputs: [],
      relatedModules: [],
    })),
  }));
  for (const module of registry.modules) {
    const moduleDirectory = path.join(paths.currentSpecs, module.id);
    const specFile = path.join(moduleDirectory, 'spec.md');
    const original = await fs.readFile(specFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    await fs.mkdir(moduleDirectory, { recursive: true });
    let currentSpecIsV1 = false;
    try { currentSpecIsV1 = parseCurrentSpecification(original).version === '1'; } catch { /* legacy or empty */ }
    if (!currentSpecIsV1) await fs.writeFile(specFile, renderLegacySpecification(module.name, module.id, original));
    const interfaceFile = path.join(moduleDirectory, 'interface.yaml');
    if (!await exists(interfaceFile)) await fs.writeFile(interfaceFile, stringifyYaml({ version: 1, module: module.id, relations: [] }));
    const apiFile = path.join(moduleDirectory, 'api.yaml');
    if (!await exists(apiFile)) await fs.writeFile(apiFile, stringifyYaml({ version: 1, module: module.id, routes: [] }));
  }
  const configurationFile = path.join(codespecDir, 'configuration.yaml');
  if (!await exists(configurationFile)) await fs.writeFile(configurationFile, stringifyYaml({ version: 1, profiles: [] }));
  await fs.mkdir(paths.transactions, { recursive: true });
  rawConfig.paths = {
    ...rawConfig.paths,
    business: 'business.yaml',
    configuration: 'configuration.yaml',
    transactions: rawConfig.paths?.transactions ?? '.transactions',
  };
  await fs.writeFile(configFile, stringifyYaml(rawConfig));
}
