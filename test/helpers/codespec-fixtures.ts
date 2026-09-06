import * as fs from 'node:fs';
import * as path from 'node:path';

/** Minimal healthy CodeSpec root layout shared by slice test suites. */
export function createCodeSpecRoot(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, 'codespec', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'codespec', 'changes', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'codespec', 'config.yaml'), 'schema: spec-driven\n');
}

/** Writes a spec file under the root's codespec/specs/<id>/spec.md. */
export function writeSpec(rootDir: string, specId: string, body: string): void {
  const specDir = path.join(rootDir, 'codespec', 'specs', specId);
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), body);
}
