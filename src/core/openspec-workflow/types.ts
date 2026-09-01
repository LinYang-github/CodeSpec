export interface WorkspaceConfig {
  version: 1;
  project: {
    name: string;
  };
  paths: {
    business: string;
    changes: string;
    change_index: string;
    archive: string;
    specs: string;
    archived_changes: string;
  };
  workflow: {
    multiple_active_changes: boolean;
  };
  requirements: {
    id_format: string;
  };
  changes: {
    id_format: string;
  };
  archive: {
    update_index: boolean;
    require_verification: boolean;
    conflict_strategy: 'optimistic';
  };
}

export interface BusinessModule {
  id: string;
  name: string;
  description?: string;
  responsibilities: string[];
  keywords: string[];
}

export interface RequirementRef {
  id: string;
  module: string;
}

export interface Scenario {
  given: string[];
  when: string[];
  then: string[];
}

export interface RequirementDelta extends RequirementRef {
  action: 'ADDED' | 'MODIFIED' | 'REMOVED';
  previous?: string;
  next?: string;
  reason?: string;
  scenarios: Scenario[];
}

export interface ChangeMetadata {
  schema_version: 1;
  change: {
    id: string;
    revision: number;
    title: string;
    mode: 'feature' | 'bugfix' | 'refactor';
    status:
      | 'ANALYZE'
      | 'DESIGN'
      | 'PLAN'
      | 'IMPLEMENT'
      | 'VERIFY'
      | 'ARCHIVE'
      | 'ARCHIVED'
      | 'ABANDONED';
    created_at: string;
    updated_at: string;
  };
  baseline: {
    created_at: string | null;
    stale: boolean;
    modules: Record<string, unknown>;
  };
  relations: {
    depends_on: string[];
    related_to: string[];
    conflicts_with: string[];
    supersedes: string[];
  };
  modules: {
    candidates: string[];
    confirmed: string[];
    dependencies: string[];
  };
  requirements: {
    added: RequirementRef[];
    modified: RequirementRef[];
    removed: RequirementRef[];
  };
  tasks: {
    total: number;
    completed: number;
    items: Record<
      string,
      {
        title?: string;
        status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
      }
    >;
  };
  verification: {
    requirements_verified: boolean;
    tests_passed: boolean;
    build_passed: boolean;
    lint_passed: boolean;
    verified_at: string | null;
  };
  archive: {
    ready: boolean;
    conflict: boolean;
    archived_at: string | null;
  };
}

export interface ChangeIndexEntry {
  id: string;
  title: string;
  mode: ChangeMetadata['change']['mode'];
  status: ChangeMetadata['change']['status'];
  updated_at: string;
}

export interface ArchivePlan {
  changeId: string;
  ready: boolean;
  conflict: boolean;
  reasons: string[];
}
