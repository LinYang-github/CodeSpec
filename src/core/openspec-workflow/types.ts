export type BusinessModuleId = `MOD-${string}`;
export type RequirementId = `MOD-${string}-REQ-${string}`;
export type ChangeId = `CHG-${string}-${string}`;
export type ScenarioId = `SCN-${string}`;
export type ModuleOutcome = 'OWNED' | 'DEPENDENCY' | 'IRRELEVANT';
export type ChangeMode = 'feature' | 'bugfix' | 'refactor';
export type ChangeStatus =
  | 'ANALYZE'
  | 'DESIGN'
  | 'PLAN'
  | 'IMPLEMENT'
  | 'VERIFY'
  | 'ARCHIVE'
  | 'ARCHIVED'
  | 'ABANDONED';

export interface WorkspaceConfig {
  version: 1;
  schema: 'code-spec';
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
  id: BusinessModuleId;
  name: string;
  description?: string;
  responsibilities: string[];
  keywords: string[];
}

export interface RequirementRef {
  id: RequirementId;
  module: BusinessModuleId;
}

export interface Scenario {
  id: ScenarioId;
  name?: string;
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
    id: ChangeId;
    revision: number;
    title: string;
    mode: ChangeMode;
    status: ChangeStatus;
    created_at: string;
    updated_at: string;
  };
  impact: {
    summary: string;
    mode: ChangeMode;
    scope: 'single-module' | 'cross-module';
  };
  baseline: {
    created_at: string | null;
    stale: boolean;
    modules: Record<
      BusinessModuleId,
      {
        outcome: ModuleOutcome;
        latest_change: ChangeId | null;
        requirement_ids: RequirementId[];
        spec_hash?: string;
        requirements?: Record<RequirementId, string>;
      }
    >;
  };
  relations: {
    depends_on: ChangeId[];
    related_to: ChangeId[];
    conflicts_with: ChangeId[];
    supersedes: ChangeId[];
  };
  gates: {
    analyze: {
      required: boolean;
      satisfied: boolean;
    };
    design: {
      required: boolean;
      satisfied: boolean;
    };
    plan: {
      required: boolean;
      satisfied: boolean;
    };
    implement: {
      required: boolean;
      satisfied: boolean;
    };
    verify: {
      required: boolean;
      satisfied: boolean;
    };
    archive: {
      required: boolean;
      satisfied: boolean;
    };
  };
  modules: {
    candidates: Array<{
      module: BusinessModuleId;
      outcome: ModuleOutcome;
      reason: string;
    }>;
    confirmed: Array<{
      module: BusinessModuleId;
      outcome: ModuleOutcome;
      reason: string;
    }>;
    dependencies: Array<{
      module: BusinessModuleId;
      outcome: Extract<ModuleOutcome, 'DEPENDENCY'>;
      reason: string;
    }>;
  };
  requirements: {
    added: RequirementRef[];
    modified: RequirementRef[];
    removed: RequirementRef[];
  };
  artifacts: {
    metadata: string;
    proposal: string;
    design: string;
    spec: string;
    tasks: string;
    verification: string;
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
  id: ChangeId;
  title: string;
  mode: ChangeMetadata['change']['mode'];
  status: ChangeMetadata['change']['status'];
  updated_at: string;
}

export interface ArchivePlan {
  changeId: ChangeId;
  ready: boolean;
  conflict: boolean;
  reasons: string[];
}
