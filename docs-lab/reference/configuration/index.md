# Overview

> Every file and setting that changes how CodeSpec behaves, and where each lives.

| File | Lives at | Controls |
| --- | --- | --- |
| [Project configuration (config.yaml)](config-yaml.md) | `codespec/config.yaml` | The schema, context, and rules this project plans with |
| [Change metadata (.codespec.yaml)](change-metadata.md) | `codespec/changes/<name>/.codespec.yaml` | The workflow schema, goal, scope, and spec exceptions for one change |
| [CLI settings (config.json)](config-json.md) | `~/.config/codespec/config.json` (Windows varies) | How the codespec CLI behaves on your machine |
| [Environment variables](environment-variables.md) | Your shell or CI environment | Telemetry opt-out, and where the config and data directories live |
| [Stores](stores.md) | `~/.local/share/codespec/stores/` (Windows varies) | The registry and metadata behind multi-repo stores |
