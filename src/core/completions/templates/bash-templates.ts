/**
 * Static template strings for Bash completion scripts.
 * These are Bash-specific helper functions that never change.
 */

export const BASH_DYNAMIC_HELPERS = `# Dynamic completion helpers

_codespec_complete_changes() {
  local changes
  changes=$(codespec __complete changes 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$changes" -- "$cur"))
}

_codespec_complete_specs() {
  local specs
  specs=$(codespec __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$specs" -- "$cur"))
}

_codespec_complete_items() {
  local items
  items=$(codespec __complete changes 2>/dev/null | cut -f1; codespec __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$items" -- "$cur"))
}

_codespec_complete_schemas() {
  local schemas
  schemas=$(codespec __complete schemas 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$schemas" -- "$cur"))
}`;
