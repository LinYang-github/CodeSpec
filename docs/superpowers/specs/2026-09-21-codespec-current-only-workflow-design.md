# CodeSpec Current-Only Workflow Design

**Date:** 2026-09-21

**Status:** Approved

## 1. Goal

CodeSpec supports only the current six-artifact workflow. An archive updates the accepted Current state and removes the active Change. It does not retain Change history or create any `archive` directory.

The accepted Current state is:

```text
codespec/specs/<MOD-ID>/spec.md
codespec/specs/<MOD-ID>/interface.yaml
codespec/specs/<MOD-ID>/api.yaml
codespec/business.yaml
codespec/configuration.yaml
```

## 2. Rules

1. An active Change contains exactly `metadata.yaml`, `analysis.yaml`, `design.md`, `spec.md`, `tasks.yaml`, and `verification.yaml`.
2. Archive accepts only this six-artifact Change shape. A proposal-bearing or five-artifact Change fails immediately. It is not migrated or archived through a compatibility path.
3. Archive projects the complete Current state, updates it in one transaction, removes the active Change, and removes any pre-existing `codespec/archive/` directory in the same transaction.
4. Existing registered modules must contain `spec.md` and `interface.yaml`. Missing files fail before archive writes. `api.yaml` is derived and is rebuilt when absent.
5. A newly registered module is created with all three module files.
6. No command, loader, configuration field, UI response, document, or generated workflow may refer to archived Change history.

## 3. Rebase And Stale Rules

Each Change baseline records one fingerprint of the complete Current state: all module files under `specs/`, plus `business.yaml` and `configuration.yaml`.

After archive, Core compares this fingerprint for every remaining active Change. A changed fingerprint marks that Change stale. The rule is deliberately global: any accepted Current change requires every other active Change to re-check its intent against the new whole-system state.

Rebase reads and validates the same Current inputs as archive. It must fail when a registered module lacks `spec.md` or `interface.yaml`; it must not treat a missing file as empty content. The CLI no longer accepts `--current-spec`, because rebase always reads the configured Current state.

## 4. Commands And UI

- Remove `codespec detect-stale`; archive itself performs stale marking.
- Remove `codespec validate --archived`; no archived Change files exist.
- Remove archive and archived-change paths from canonical workspace configuration and loaders.
- Remove archived Change lookup from `show`, `status`, and other canonical commands.
- CLI archive keeps its explicit interactive confirmation.
- UI archive uses a preflight result with a one-time confirmation token. POST requires the token and rejects a changed or expired preflight result.

## 5. Failure Rules

- Old Change layout: fail with a message that only the six-artifact workflow is supported.
- Missing Current source file: fail before any write.
- Current changes after preview or before commit: fail and require a fresh preview.
- Transaction failure: restore all Current files and retain the active Change.
- Existing archive directories: remove them only as part of a successful archive transaction or an explicit cleanup command.

## 6. Verification

Tests must cover:

- archive leaves no archive directory or archived Change copy;
- old Change layouts fail in archive and rebase;
- any successful archive marks every other active Change stale;
- rebase rejects missing `spec.md` and `interface.yaml`;
- rebase rebuilds its baseline from the whole Current state;
- missing `api.yaml` is regenerated during archive;
- UI POST rejects missing, expired, or mismatched confirmation tokens;
- no CLI command or generated workflow references archived Change history.

Documentation and generated workflow templates must describe `specs/`, `business.yaml`, and `configuration.yaml` as the only accepted archive result.
