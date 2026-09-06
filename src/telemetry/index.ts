/**
 * Telemetry boundary for CodeSpec.
 *
 * CodeSpec 1.0 has no provisioned HRHY-owned telemetry endpoint or key. The
 * boundary stays in place so the CLI remains stable, but it is deliberately a
 * no-op: it creates no identifier, persists no telemetry state and sends no
 * network request.
 */

/** Telemetry is disabled until an HRHY-owned endpoint is explicitly provisioned. */
export function isTelemetryEnabled(): boolean {
  return false;
}

/** Records no data while telemetry is unprovisioned. */
export async function trackCommand(_commandName: string, _version: string): Promise<void> {
  return;
}

/** Shows no notice because the CLI collects no telemetry. */
export async function maybeShowTelemetryNotice(
  _options: { silent?: boolean } = {}
): Promise<void> {
  return;
}

/** No telemetry requests are in flight. */
export async function shutdown(): Promise<void> {
  return;
}
