/**
 * Global configuration for telemetry state.
 * Stores anonymous ID and notice-seen flag in the platform-appropriate config directory.
 */
import { promises as fs } from 'fs';
import path from 'path';
import {
  GLOBAL_CONFIG_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
  getGlobalConfigDir,
  type TelemetryConfig,
} from '../core/global-config.js';

// Constants
export const CONFIG_DIR_NAME = GLOBAL_CONFIG_DIR_NAME;
export const CONFIG_FILE_NAME = GLOBAL_CONFIG_FILE_NAME;

/** Re-export shared telemetry section type (single source of truth in global-config). */
export type { TelemetryConfig };

export interface GlobalConfig {
  telemetry?: TelemetryConfig;
  [key: string]: unknown; // Preserve other fields
}

type ConfigReadResult =
  | { status: 'missing' }
  | { status: 'ok'; config: GlobalConfig }
  | { status: 'invalid'; config: GlobalConfig };

function getConfigDir(): string {
  return getGlobalConfigDir();
}

async function readConfigFile(configPath: string): Promise<ConfigReadResult> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return { status: 'ok', config: JSON.parse(content) as GlobalConfig };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    // If parse fails or another read error occurs, ignore the file.
    return { status: 'invalid', config: {} };
  }
}

async function writeConfigFile(configPath: string, config: GlobalConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Get the path to the global config file.
 * Follows XDG Base Directory Specification and platform conventions.
 *
 * - All platforms: $XDG_CONFIG_HOME/codespec/ if XDG_CONFIG_HOME is set
 * - Unix/macOS fallback: ~/.config/codespec/
 * - Windows fallback: %APPDATA%/codespec/
 */
export function getConfigPath(): string {
  const configDir = getConfigDir();
  return path.join(configDir, CONFIG_FILE_NAME);
}

/**
 * Read the global config file.
 * Returns an empty object if the file doesn't exist.
 */
export async function readConfig(): Promise<GlobalConfig> {
  const configPath = getConfigPath();
  const read = await readConfigFile(configPath);
  return read.status === 'ok' ? read.config : {};
}

/**
 * Write to the global config file.
 * Preserves existing fields and merges in new values.
 */
export async function writeConfig(updates: Partial<GlobalConfig>): Promise<void> {
  const configPath = getConfigPath();

  // Read existing config and merge
  const existing = await readConfig();
  const merged = { ...existing, ...updates };

  // Deep merge for telemetry object
  if (updates.telemetry && existing.telemetry) {
    merged.telemetry = { ...existing.telemetry, ...updates.telemetry };
  }

  await writeConfigFile(configPath, merged);
}

/**
 * Get the telemetry config section.
 */
export async function getTelemetryConfig(): Promise<TelemetryConfig> {
  const config = await readConfig();
  return config.telemetry ?? {};
}

/**
 * Update the telemetry config section.
 */
export async function updateTelemetryConfig(updates: Partial<TelemetryConfig>): Promise<void> {
  const existing = await getTelemetryConfig();
  await writeConfig({
    telemetry: { ...existing, ...updates },
  });
}
