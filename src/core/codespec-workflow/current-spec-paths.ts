import path from 'node:path';

export interface CurrentModuleArtifactPaths {
  directory: string;
  spec: string;
  interface: string;
  api: string;
}

export function getCurrentModuleArtifactPaths(
  currentSpecsDirectory: string,
  moduleId: string,
): CurrentModuleArtifactPaths {
  if (!/^MOD-\d{3}$/u.test(moduleId)) {
    throw new Error(`Invalid module ID: ${moduleId}`);
  }

  const directory = path.join(currentSpecsDirectory, moduleId);
  return {
    directory,
    spec: path.join(directory, 'spec.md'),
    interface: path.join(directory, 'interface.yaml'),
    api: path.join(directory, 'api.yaml'),
  };
}
